#!/usr/bin/env python3
"""CoachGG — analyse vidéo assistée (version auto-0.1.0).

Mesure uniquement des signaux VISIBLES dans l'image ; n'interprète pas le jeu :

  1. Désaturation de la vue de jeu  -> « écran grisé » (dans LoL : écran de mort).
  2. Intensité de mouvement           -> séquences de forte activité (engagement probable
                                         OU simple déplacement de caméra : non distinguable).
  3. Marqueurs rouges sur la minimap  -> uniquement si la zone minimap est déclarée ;
                                         mesurés AVANT l'événement (jamais après).

Pas de lecture mémoire, pas de modèle entraîné, aucune donnée externe.

Entrée  : chemin vidéo + paramètres (voir --help).
Sortie  : JSON sur stdout. Progression sur stderr : « PROGRESS <0-100> ».
Fichiers: planches de contexte JPEG dans --out.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass

import cv2
import numpy as np

VERSION = "auto-0.1.0"

# Paramètres des règles (figés pour cette version).
GAME_REGION = (0.05, 0.05, 0.90, 0.67)  # x, y, w, h normalisés : exclut l'interface du bas
GREY_RATIO = 0.35        # saturation < 35 % de la référence => image grisée (au moins une fois dans le segment)
GREY_EXTEND_RATIO = 0.45 # bornes du segment : < 45 % (l'écran de mort s'éclaircit vers la réapparition)
GREY_END_MIN_SEC = 1.5   # écran grisé coupé par la fin de la vidéo : 1,5 s suffisent
GREY_MIN_SEC = 2.0       # les clips coupés ne gardent souvent que 2-3 s de l'écran de mort
MIN_BASELINE_SAT = 25.0  # vidéo déjà peu colorée => détection désactivée
ACTIVITY_MIN_SEC = 2.0
ACTIVITY_FACTOR = 2.5    # mouvement > 2,5 x la médiane
MAX_DEATHS = 12
MAX_ACTIVITY = 3
RED_RISE_MIN = 0.01      # +1 % de la surface de la minimap
SHEET_FRAMES = 8
SAMPLE_WIDTH = 320


def log_progress(p: float) -> None:
    print(f"PROGRESS {int(max(0, min(100, p)))}", file=sys.stderr, flush=True)


# ───────────────────────── fonctions pures (testées) ─────────────────────────

def segments(mask: np.ndarray, min_len: int, max_gap: int = 1) -> list[tuple[int, int]]:
    """Segments [début, fin] (indices inclus) où mask est vrai, en fusionnant les trous <= max_gap."""
    segs: list[list[int]] = []
    for i, v in enumerate(mask):
        if not v:
            continue
        if segs and i - segs[-1][1] <= max_gap + 1:
            segs[-1][1] = i
        else:
            segs.append([i, i])
    return [(a, b) for a, b in segs if b - a + 1 >= min_len]


def smooth(x: np.ndarray, k: int = 3) -> np.ndarray:
    if len(x) < k:
        return x.astype(float)
    return np.convolve(x, np.ones(k) / k, mode="same")


def red_mask(bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    return ((h < 10) | (h > 170)) & (s > 120) & (v > 90)


def frame_saturation(game_bgr: np.ndarray) -> float:
    """Saturation MÉDIANE de la zone de jeu : insensible aux incrustations restées en couleur
    (webcam, chat, alertes de stream) qui faussent la moyenne pendant l'écran de mort."""
    return float(np.median(cv2.cvtColor(game_bgr, cv2.COLOR_BGR2HSV)[..., 1]))


def detect_grey(sat: np.ndarray, fps: float) -> tuple[list[dict], float, list[str]]:
    warnings: list[str] = []
    baseline = float(np.median(sat)) if len(sat) else 0.0
    if baseline < MIN_BASELINE_SAT:
        warnings.append("Vidéo peu colorée : détection d'écran grisé désactivée.")
        return [], baseline, warnings
    # Hystérésis : segment délimité au seuil souple, gardé seulement s'il passe sous le seuil strict.
    low = sat < GREY_EXTEND_RATIO * baseline
    end_min = max(1, int(round(GREY_END_MIN_SEC * fps)))
    full_min = max(1, int(round(GREY_MIN_SEC * fps)))
    out = []
    for a, b in segments(low, end_min):
        if b - a + 1 < full_min and b < len(sat) - 1 - max(1, int(round(fps))):
            continue  # trop court, sauf s'il est coupé par la fin de la vidéo (ou s'arrête moins d'1 s avant)
        if float(np.min(sat[a : b + 1])) >= GREY_RATIO * baseline:
            continue
        ratio = float(np.mean(sat[a : b + 1]) / baseline)
        dur = (b - a + 1) / fps
        out.append({
            "startIdx": a, "endIdx": b,
            "saturationRatio": round(ratio, 3), "durationSec": round(dur, 1),
            "confidence": "MEDIUM" if dur >= 6 and ratio <= 0.25 else "LOW",
        })
    return out[:MAX_DEATHS], baseline, warnings


REFINE_FPS = 60.0  # pas de 17 ms (images dupliquées si la vidéo est en 30 i/s : précision = 1 image)


def first_grey_index(sats: list[float], threshold: float) -> int | None:
    """Premier échantillon sous le seuil de saturation, suivi d'au moins 2 autres (évite un flash isolé)."""
    for i in range(len(sats)):
        window = sats[i : i + 3]
        if len(window) == 3 and all(x < threshold for x in window):
            return i
    return None


def grey_onset(sats: list[float], i: int) -> int:
    """Instant réel de la mort à partir du premier échantillon « gris » i :
    • chute brutale d'une image à l'autre → c'est le début (on ne remonte pas) ;
    • fondu progressif → on remonte la baisse, image par image, jusqu'au niveau d'avant ;
    • jamais à travers un palier (> 4 images identiques) ni plus de 0,66 s en arrière.
    Calé sur le banc d'essai (fondus) ET sur un vrai clip (petite baisse de décor 0,5 s avant la mort)."""
    ref = max(sats[max(0, i - 40) : max(1, i)])
    k = j = i
    plateau = 0
    while j > 0 and i - j < 40:
        prev, cur = sats[j - 1], sats[j]
        if prev - cur > 0.4 * ref:
            break  # chute brutale : l'image courante est le début
        if prev > cur + 0.5:
            if prev >= ref * 0.94:
                break  # niveau d'avant la mort atteint
            k = j - 1
            plateau = 0
        elif abs(prev - cur) <= 0.5:
            plateau += 1  # image dupliquée (vidéo en 30 i/s lue à 60) ou palier
            if plateau > 4:
                break
        else:
            break  # la saturation remonte en arrière : pas un fondu
        j -= 1
    return k


def refine_grey_start(video: str, width: int, height: int, start_s: float, baseline: float, ffmpeg: str) -> float | None:
    """Affine le début d'un écran grisé : 1,6 s autour de la détection, à 60 images/s, puis début de la baisse."""
    w = SAMPLE_WIDTH
    h = int(round(w * height / width / 2) * 2)
    t0 = max(0.0, start_s - 1.0)
    cmd = [ffmpeg, "-v", "error", "-nostdin", "-ss", f"{t0:.3f}", "-i", video, "-t", "1.6",
           "-vf", f"fps={REFINE_FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    try:
        raw = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60).stdout
    except Exception:
        return None
    gx, gy, gw, gh = GAME_REGION
    gsl = (slice(int(gy * h), int((gy + gh) * h)), slice(int(gx * w), int((gx + gw) * w)))
    fb = w * h * 3
    sats = []
    for k in range(len(raw) // fb):
        frame = np.frombuffer(raw[k * fb : (k + 1) * fb], np.uint8).reshape(h, w, 3)
        sats.append(frame_saturation(frame[gsl]))
    i = first_grey_index(sats, GREY_EXTEND_RATIO * baseline)
    return None if i is None else t0 + grey_onset(sats, i) / REFINE_FPS


def detect_activity(motion: np.ndarray, fps: float, exclude: list[tuple[int, int]]) -> tuple[list[dict], float]:
    if len(motion) < 3:
        return [], 0.0
    m = smooth(motion)
    med = float(np.median(m))
    thr = max(med * ACTIVITY_FACTOR, float(np.percentile(m, 90)), 1.0)
    hot = m > thr
    for a, b in exclude:
        hot[max(0, a) : b + 1] = False
    found = []
    for a, b in segments(hot, max(1, int(round(ACTIVITY_MIN_SEC * fps)))):
        mean = float(np.mean(m[a : b + 1]))
        found.append({"startIdx": a, "endIdx": b, "motionMean": round(mean, 2), "ratioToMedian": round(mean / max(med, 1e-6), 2)})
    found.sort(key=lambda e: -e["motionMean"])
    return found[:MAX_ACTIVITY], med


def minimap_rise(red: np.ndarray, masks: list[np.ndarray], start: int, ctx: int) -> dict | None:
    """Hausse des marqueurs rouges sur la minimap dans [start-ctx, start[ par rapport aux 20 s d'avant."""
    a = max(0, start - ctx)
    if a >= start:
        return None
    base_from = max(0, a - 2 * ctx)
    base = float(np.median(red[base_from:a])) if a > base_from else float(red[a])
    window = smooth(red[a:start]) if start - a >= 3 else red[a:start]
    j = int(np.argmax(window))
    peak = float(window[j])
    rise = peak - base
    out = {"baseline": round(base, 4), "peak": round(peak, 4), "rise": round(rise, 4), "peakIdx": a + j, "centroid": None}
    if rise >= RED_RISE_MIN and base_from < a:
        ref = np.median(np.stack(masks[base_from:a]).astype(np.uint8), axis=0) > 0.5
        new = masks[a + j] & ~ref
        ys, xs = np.nonzero(new)
        if len(xs) >= 3:
            hgt, wid = new.shape
            out["centroid"] = {"x": round(float(xs.mean()) / wid, 4), "y": round(float(ys.mean()) / hgt, 4)}
    return out


# ───────────────────────────── extraction ─────────────────────────────

@dataclass
class Series:
    sat: np.ndarray
    motion: np.ndarray
    red: np.ndarray | None
    masks: list[np.ndarray]


def sample_video(video: str, width: int, height: int, fps: float, minimap, duration_s: float, threads: int, ffmpeg: str) -> Series:
    w = SAMPLE_WIDTH
    h = int(round(w * height / width / 2) * 2)
    cmd = [ffmpeg, "-v", "error", "-nostdin", "-threads", str(threads), "-i", video,
           "-vf", f"fps={fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    gx, gy, gw, gh = GAME_REGION
    gsl = (slice(int(gy * h), int((gy + gh) * h)), slice(int(gx * w), int((gx + gw) * w)))
    msl = None
    if minimap:
        mx, my, mw, mh = minimap
        msl = (slice(int(my * h), max(int(my * h) + 1, int((my + mh) * h))), slice(int(mx * w), max(int(mx * w) + 1, int((mx + mw) * w))))
    sats, motions, reds, masks = [], [], [], []
    prev = None
    frame_bytes = w * h * 3
    expected = max(1, int(duration_s * fps))
    n = 0
    assert proc.stdout is not None
    while True:
        buf = proc.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        game = frame[gsl]
        sats.append(frame_saturation(game))
        gray = cv2.cvtColor(game, cv2.COLOR_BGR2GRAY).astype(np.int16)
        motions.append(0.0 if prev is None else float(np.abs(gray - prev).mean()))
        prev = gray
        if msl is not None:
            mk = red_mask(frame[msl])
            masks.append(mk)
            reds.append(float(mk.mean()))
        n += 1
        if n % 20 == 0:
            log_progress(5 + 75 * n / expected)
    proc.wait()
    if n == 0:
        raise RuntimeError("Aucune image décodée.")
    return Series(np.array(sats), np.array(motions), np.array(reds) if msl is not None else None, masks)


MM_FRAMES = 7          # images réparties dans la vidéo pour repérer la minimap
MM_WIDTH = 960         # résolution de travail (précision ~0,1 % de la largeur)
MM_MIN_CONF = 0.62     # persistance minimale du cadre (banc d'essai : vraies minimaps ≥ 0,65 ; mire de test 0,56)
MM_SQUARE_TOL = 0.03   # une minimap est carrée en pixels (banc : ≤ 2 % d'écart ; faux positif : 4,5 %)


def edge_persistence(frames: list[np.ndarray]) -> np.ndarray:
    """Part des images où chaque pixel est un bord : ~1 pour l'interface fixe (cadre de la minimap), faible pour le jeu qui bouge."""
    acc = None
    for f in frames:
        g = cv2.GaussianBlur(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (3, 3), 0)
        e = (cv2.Canny(g, 40, 120) > 0).astype(np.float32)
        e = cv2.dilate(e, np.ones((2, 2), np.uint8))  # tolère 1 px de compression
        acc = e if acc is None else acc + e
    return acc / max(1, len(frames))


def find_minimap(pers: np.ndarray) -> dict | None:
    """Plus forte persistance moyenne sur les 4 côtés d'un CARRÉ (en pixels) collé à un coin bas de l'image."""
    h, w = pers.shape
    row_cum = np.concatenate([np.zeros((h, 1), np.float32), np.cumsum(pers, axis=1)], axis=1)  # sommes par ligne
    col_cum = np.concatenate([np.zeros((1, w), np.float32), np.cumsum(pers, axis=0)], axis=0)  # sommes par colonne

    def hline(y, x0, x1):
        return (row_cum[y, x1] - row_cum[y, x0]) / max(1, x1 - x0)

    def vline(x, y0, y1):
        return (col_cum[y1, x] - col_cum[y0, x]) / max(1, y1 - y0)

    best = None
    for side in ("right", "left"):
        for s in range(int(h * 0.14), int(h * 0.46)):
            for mb in range(0, int(h * 0.05) + 1):
                y0 = h - mb - s
                if y0 < 0:
                    continue
                for mr in range(0, int(w * 0.03) + 1):
                    x0 = w - mr - s if side == "right" else mr
                    x1 = x0 + s - 1
                    y1 = y0 + s - 1
                    if x0 < 0 or x1 >= w:
                        continue
                    # côtés : on prend le meilleur de la ligne et de sa voisine intérieure (épaisseur du cadre)
                    top = max(hline(y0, x0, x1), hline(min(y0 + 1, h - 1), x0, x1))
                    bottom = max(hline(y1, x0, x1), hline(max(y1 - 1, 0), x0, x1))
                    left = max(vline(x0, y0, y1), vline(min(x0 + 1, w - 1), y0, y1))
                    right = max(vline(x1, y0, y1), vline(max(x1 - 1, 0), y0, y1))
                    score = (top + left + min(bottom, right) * 0.5 + max(bottom, right) * 0.5) / 3.0
                    score = min(score, 3 * min(top, left))  # le haut ET le côté intérieur doivent être nets
                    if best is None or score > best[0]:
                        best = (score, x0, y0, s)
    if best is None or best[0] < MM_MIN_CONF:
        return None
    score, x0, y0, s = best
    return {"x": x0 / w, "y": y0 / h, "w": s / w, "h": s / h, "confidence": round(float(score), 3)}


def detect_minimap(video: str, width: int, height: int, duration_s: float, ffmpeg: str) -> dict | None:
    """Zone de la minimap détectée automatiquement (None si aucun cadre net : à régler à la main)."""
    w = MM_WIDTH
    h = int(round(w * height / width / 2) * 2)
    frames = []
    for k in range(MM_FRAMES):
        t = duration_s * (0.08 + 0.84 * k / max(1, MM_FRAMES - 1))
        cmd = [ffmpeg, "-v", "error", "-nostdin", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
        try:
            raw = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60).stdout
        except Exception:
            continue
        if len(raw) == w * h * 3:
            frames.append(np.frombuffer(raw, np.uint8).reshape(h, w, 3))
    if len(frames) < 3:
        return None
    # Recherche sur une image réduite de moitié (rapide), puis affinage au pixel autour du résultat.
    pers = edge_persistence(frames)
    small = cv2.resize(pers, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    coarse = find_minimap(small)
    if not coarse:
        return None
    fine = refine_minimap(pers, coarse)
    g = fine or coarse
    ratio = (g["w"] * w) / max(1e-6, g["h"] * h)
    if abs(ratio - 1) > MM_SQUARE_TOL:
        return None  # pas carré : grille ou élément d'interface, pas une minimap
    return g


def refine_minimap(pers: np.ndarray, g: dict) -> dict | None:
    """Affinage au pixel près, côté par côté : le cadre a deux bords (extérieur et intérieur) ; pour chaque côté, on prend
    le CENTRE du trait du cadre le plus à l'extérieur, dans un voisinage de ±8 px (comme une zone réglée à la main)."""
    h, w = pers.shape
    x0c, y0c, s = int(round(g["x"] * w)), int(round(g["y"] * h)), int(round(g["h"] * h))
    x1c, y1c = x0c + s - 1, y0c + s - 1
    span_x = (max(0, x0c + s // 8), min(w, x1c - s // 8))  # partie centrale des côtés (évite les coins arrondis)
    span_y = (max(0, y0c + s // 8), min(h, y1c - s // 8))

    def best_line(score, lo, hi, outward_low: bool):
        vals = [(k, score(k)) for k in range(max(0, lo), min(hi, (h if score is row else w) - 1) + 1)]
        if not vals:
            return None
        top = max(v for _, v in vals)
        # Groupes de lignes nettes contiguës (un bord du trait = un groupe), du plus extérieur au plus intérieur.
        strong = sorted((k for k, v in vals if v >= 0.35 * top), reverse=not outward_low)
        groups: list[list[int]] = []
        for k in strong:
            if groups and abs(k - groups[-1][-1]) <= 1:
                groups[-1].append(k)
            else:
                groups.append([k])
        centre = lambda grp: sum(grp) / len(grp)  # noqa: E731
        outer = centre(groups[0])
        # Le trait du cadre a un bord extérieur et un bord intérieur : on prend le milieu des deux.
        inner = next((centre(g) for g in groups[1:] if 2 <= abs(centre(g) - outer) <= 10), None)
        return int(round((outer + inner) / 2)) if inner is not None else int(round(outer))

    def row(y):
        return float(pers[y, span_x[0]:span_x[1]].mean()) if span_x[1] > span_x[0] else 0.0

    def col(x):
        return float(pers[span_y[0]:span_y[1], x].mean()) if span_y[1] > span_y[0] else 0.0

    top = best_line(row, y0c - 8, y0c + 8, True)
    bottom = best_line(row, y1c - 8, y1c + 8, False)
    left = best_line(col, x0c - 8, x0c + 8, True)
    right = best_line(col, x1c - 8, x1c + 8, False)
    if None in (top, bottom, left, right) or bottom <= top or right <= left:
        return None
    return {"x": left / w, "y": top / h, "w": (right - left + 1) / w, "h": (bottom - top + 1) / h, "confidence": g["confidence"]}


def contact_sheet(video: str, t_from: float, t_to: float, out_path: str, ffmpeg: str) -> bool:
    """Planche de 8 images entre t_from et t_to (contexte AVANT l'événement), horodatées en relatif."""
    tiles = []
    times = np.linspace(t_from, t_to, SHEET_FRAMES)
    for t in times:
        r = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-ss", f"{max(0, t):.2f}", "-i", video, "-frames:v", "1",
                            "-vf", "scale=320:-2", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, timeout=30)
        img = cv2.imdecode(np.frombuffer(r.stdout, np.uint8), cv2.IMREAD_COLOR) if r.stdout else None
        if img is None:
            return False
        d = t - t_to
        label = "evenement" if abs(d) < 0.05 else f"{d:.1f} s".replace(".", ",")
        cv2.rectangle(img, (0, 0), (92, 22), (10, 13, 20), -1)
        cv2.putText(img, label, (5, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(img)
    hmin = min(t.shape[0] for t in tiles)
    tiles = [t[:hmin] for t in tiles]
    rows = [np.hstack(tiles[i : i + 4]) for i in range(0, len(tiles), 4)]
    return bool(cv2.imwrite(out_path, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 82]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, required=True)
    ap.add_argument("--height", type=int, required=True)
    ap.add_argument("--duration-ms", type=int, required=True)
    ap.add_argument("--fps", type=float, default=2.0)
    ap.add_argument("--context-sec", type=float, default=10.0)
    ap.add_argument("--minimap", default="", help="x,y,w,h normalisés")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--ffmpeg", default="ffmpeg")
    a = ap.parse_args()
    cv2.setNumThreads(a.threads)
    os.makedirs(a.out, exist_ok=True)

    minimap = tuple(float(v) for v in a.minimap.split(",")) if a.minimap else None
    duration_s = a.duration_ms / 1000
    log_progress(1)
    # Minimap détectée automatiquement (cadre fixe dans un coin bas) : utilisée si aucune zone n'a été réglée.
    minimap_guess = detect_minimap(a.video, a.width, a.height, duration_s, a.ffmpeg)
    minimap_source = "manual" if minimap else None
    if minimap is None and minimap_guess:
        minimap = (minimap_guess["x"], minimap_guess["y"], minimap_guess["w"], minimap_guess["h"])
        minimap_source = "auto"
    log_progress(2)
    s = sample_video(a.video, a.width, a.height, a.fps, minimap, duration_s, a.threads, a.ffmpeg)
    fps = a.fps
    ms = lambda i: int(round(i * 1000 / fps))  # noqa: E731
    ctx = max(1, int(round(a.context_sec * fps)))

    warnings: list[str] = []
    if minimap is None:
        warnings.append("Zone minimap non définie et non détectée automatiquement : signaux minimap non analysés.")
    greys, sat_base, w1 = detect_grey(s.sat, fps)
    warnings += w1
    acts, motion_med = detect_activity(s.motion, fps, [(g["startIdx"] - ctx, g["endIdx"]) for g in greys])
    log_progress(82)

    events = []
    total = max(1, len(greys) + len(acts))
    for k, g in enumerate(greys):
        a0 = max(0, g["startIdx"] - ctx)
        pre = s.motion[a0 : g["startIdx"]]
        refined = refine_grey_start(a.video, a.width, a.height, g["startIdx"] / fps, sat_base, a.ffmpeg)
        start_ms = int(round(refined * 1000)) if refined is not None and abs(refined * 1000 - ms(g["startIdx"])) <= 1200 else ms(g["startIdx"])
        ev = {
            "type": "grey_screen",
            "startMs": start_ms,
            "endMs": ms(g["endIdx"] + 1),
            "confidence": g["confidence"],
            "metrics": {"saturationRatio": g["saturationRatio"], "durationSec": g["durationSec"]},
            "context": {
                "fromMs": ms(a0),
                "toMs": ms(g["startIdx"]),
                "motionMean": round(float(pre.mean()), 2) if len(pre) else None,
                "motionRatioToMedian": round(float(pre.mean()) / max(motion_med, 1e-6), 2) if len(pre) else None,
                "minimap": None,
            },
            "sheet": None,
        }
        if s.red is not None:
            r = minimap_rise(s.red, s.masks, g["startIdx"], ctx)
            if r:
                r["peakMs"] = ms(r.pop("peakIdx"))
                ev["context"]["minimap"] = r
        sheet = os.path.join(a.out, f"sheet_{k}.jpg")
        if contact_sheet(a.video, ev["context"]["fromMs"] / 1000, ev["startMs"] / 1000, sheet, a.ffmpeg):
            ev["sheet"] = os.path.basename(sheet)
        events.append(ev)
        log_progress(82 + 16 * (k + 1) / total)
    for k, e in enumerate(acts):
        ev = {
            "type": "high_activity",
            "startMs": ms(e["startIdx"]),
            "endMs": ms(e["endIdx"] + 1),
            "confidence": "LOW",
            "metrics": {"motionMean": e["motionMean"], "ratioToMedian": e["ratioToMedian"]},
            "context": {"fromMs": ms(max(0, e["startIdx"] - ctx)), "toMs": ms(e["startIdx"]), "minimap": None},
            "sheet": None,
        }
        sheet = os.path.join(a.out, f"act_{k}.jpg")
        if contact_sheet(a.video, ev["context"]["fromMs"] / 1000, ev["startMs"] / 1000, sheet, a.ffmpeg):
            ev["sheet"] = os.path.basename(sheet)
        events.append(ev)
        log_progress(82 + 16 * (len(greys) + k + 1) / total)

    events.sort(key=lambda e: e["startMs"])
    json.dump({
        "version": VERSION,
        "sampling": {"fps": fps, "frames": int(len(s.sat)), "width": SAMPLE_WIDTH},
        "baselines": {"saturation": round(sat_base, 2), "motionMedian": round(motion_med, 3), "minimap": minimap is not None},
        "minimapGuess": minimap_guess,
        "minimapSource": minimap_source,
        "events": events,
        "warnings": warnings,
    }, sys.stdout)
    log_progress(100)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # message lisible pour le worker
        print(f"ERROR {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)
