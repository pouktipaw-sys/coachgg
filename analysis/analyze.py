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
GREY_RATIO = 0.35        # saturation < 35 % de la référence => image grisée
GREY_MIN_SEC = 3.0
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


def detect_grey(sat: np.ndarray, fps: float) -> tuple[list[dict], float, list[str]]:
    warnings: list[str] = []
    baseline = float(np.median(sat)) if len(sat) else 0.0
    if baseline < MIN_BASELINE_SAT:
        warnings.append("Vidéo peu colorée : détection d'écran grisé désactivée.")
        return [], baseline, warnings
    low = sat < GREY_RATIO * baseline
    out = []
    for a, b in segments(low, max(1, int(round(GREY_MIN_SEC * fps)))):
        ratio = float(np.mean(sat[a : b + 1]) / baseline)
        dur = (b - a + 1) / fps
        out.append({
            "startIdx": a, "endIdx": b,
            "saturationRatio": round(ratio, 3), "durationSec": round(dur, 1),
            "confidence": "MEDIUM" if dur >= 6 and ratio <= 0.25 else "LOW",
        })
    return out[:MAX_DEATHS], baseline, warnings


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
        hsv = cv2.cvtColor(game, cv2.COLOR_BGR2HSV)
        sats.append(float(hsv[..., 1].mean()))
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
    log_progress(2)
    s = sample_video(a.video, a.width, a.height, a.fps, minimap, duration_s, a.threads, a.ffmpeg)
    fps = a.fps
    ms = lambda i: int(round(i * 1000 / fps))  # noqa: E731
    ctx = max(1, int(round(a.context_sec * fps)))

    warnings: list[str] = []
    if minimap is None:
        warnings.append("Zone minimap non définie : signaux minimap non analysés.")
    greys, sat_base, w1 = detect_grey(s.sat, fps)
    warnings += w1
    acts, motion_med = detect_activity(s.motion, fps, [(g["startIdx"] - ctx, g["endIdx"]) for g in greys])
    log_progress(82)

    events = []
    total = max(1, len(greys) + len(acts))
    for k, g in enumerate(greys):
        a0 = max(0, g["startIdx"] - ctx)
        pre = s.motion[a0 : g["startIdx"]]
        ev = {
            "type": "grey_screen",
            "startMs": ms(g["startIdx"]),
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
