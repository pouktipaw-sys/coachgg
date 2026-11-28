"""Banc d'essai de l'analyse vidéo : génère des vidéos de type LoL avec leurs « bonnes réponses ».

    python analysis/bench/make_corpus.py <dossier>   (Python de .venv-analysis, FFmpeg requis)

Chaque vidéo : carte texturée qui défile (caméra), champions, interface du bas, minimap carrée à cadre doré avec
points bleus/rouges, et selon le scénario : écrans de mort (le jeu se grise en ~0,3 s, l'interface et la minimap
restent en couleur, comme dans LoL), webcam et chat de streamer, compression forte, 60 i/s, ultra-large, minimap à
gauche, et des PIÈGES qui ne sont pas des morts : scène sombre, tableau des scores (Tab), boutique ouverte, fondu au noir.
labels.json : morts (temps vidéo, s), zone minimap exacte, pièges.
"""
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np

RNG = np.random.default_rng(7)


def texture(w: int, h: int, seed: int) -> np.ndarray:
    """Carte : grandes taches vert/brun/bleu (saturation moyenne, comme la Faille), chemins plus clairs."""
    r = np.random.default_rng(seed)
    small = r.random((h // 40 + 2, w // 40 + 2, 3)).astype(np.float32)
    big = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    base = np.stack([40 + 50 * big[..., 0], 90 + 70 * big[..., 1], 60 + 40 * big[..., 2]], -1)  # BGR verdâtre
    water = big[..., 2] > 0.75
    base[water] = (150, 110, 50)
    noise = r.normal(0, 8, (h, w, 3))
    img = np.clip(base + noise, 0, 255).astype(np.uint8)
    for _ in range(6):  # chemins
        x0, y0, x1, y1 = (int(v) for v in r.integers(0, [w, h, w, h]))
        cv2.line(img, (x0, y0), (x1, y1), (120, 150, 160), 18)
    return img


def grey(img: np.ndarray, k: float) -> np.ndarray:
    """Désature (k = 0 couleur, 1 gris) et assombrit légèrement, comme l'écran de mort."""
    g = cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    out = img.astype(np.float32) * (1 - k) + g.astype(np.float32) * k
    return np.clip(out * (1 - 0.15 * k), 0, 255).astype(np.uint8)


def render(path: str, sc: dict) -> dict:
    W, H = sc["internal"]
    fps, dur = sc["fps"], sc["dur"]
    world = texture(W * 3, H * 3, sc["seed"])
    mm_frac = sc.get("mm_size", 0.26)
    side = int(mm_frac * H)
    mx = W - side - 4 if sc.get("mm_side", "right") == "right" else 4
    my = H - side - 4
    minimap_tex = cv2.resize(world, (side, side), interpolation=cv2.INTER_AREA)
    minimap_tex = (minimap_tex * 0.7).astype(np.uint8)
    champs = [(RNG.uniform(0, 1), RNG.uniform(0, 1), RNG.uniform(0.2, 1.2), RNG.uniform(0, 6.28), i < 5) for i in range(10)]
    deaths = sc.get("deaths", [])
    traps = sc.get("traps", [])
    proc = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
         "-vf", f"scale={sc['out'][0]}:{sc['out'][1]}:flags=bicubic", "-c:v", "libx264", "-preset", "veryfast", "-crf", str(sc.get("crf", 23)),
         "-pix_fmt", "yuv420p", path],
        stdin=subprocess.PIPE,
    )
    n = int(dur * fps)
    for i in range(n):
        t = i / fps
        # Caméra : centre qui se promène dans la carte (3W × 3H), cadre toujours entièrement dedans.
        cx = int(1.5 * W + 0.9 * W * math.sin(t * 0.13 + sc["seed"]))
        cy = int(1.5 * H + 0.9 * H * math.cos(t * 0.11 + sc["seed"]))
        frame = world[cy - H // 2: cy - H // 2 + H, cx - W // 2: cx - W // 2 + W].copy()
        for (px, py, sp, ph, blue) in champs[:4]:
            x = int(W * (0.3 + 0.4 * (0.5 + 0.5 * math.sin(t * sp + ph))))
            y = int(H * (0.2 + 0.4 * (0.5 + 0.5 * math.cos(t * sp * 0.8 + ph))))
            cv2.circle(frame, (x, y), H // 30, (220, 120, 40) if blue else (40, 50, 220), -1)
        # Écran de mort : le jeu (pas l'interface) se grise en 0,3 s, puis se recolore au retour.
        k = 0.0
        for (a, b) in deaths:
            if a <= t < b:
                k = max(k, min(1.0, (t - a) / 0.3)) * (0.92 if t - a > 0.3 else 1)
        if k:
            frame = grey(frame, k)
        for tr in traps:
            if tr["from"] <= t < tr["to"]:
                kind = tr["kind"]
                if kind == "dark":  # scène sombre (brouillard, nuit) : couleurs conservées, image plus sombre
                    frame = (frame * 0.35).astype(np.uint8)
                elif kind == "scoreboard":  # tableau des scores (Tab) : grand panneau sombre semi-transparent
                    x0, y0, x1, y1 = int(W * 0.15), int(H * 0.12), int(W * 0.85), int(H * 0.78)
                    panel = frame[y0:y1, x0:x1].astype(np.float32) * 0.25 + np.array((30, 28, 26), np.float32)
                    frame[y0:y1, x0:x1] = np.clip(panel, 0, 255).astype(np.uint8)
                    for r_ in range(10):
                        yy = y0 + 20 + r_ * (y1 - y0 - 40) // 10
                        cv2.rectangle(frame, (x0 + 20, yy), (x0 + 60, yy + 18), (200, 120, 60) if r_ < 5 else (60, 60, 200), -1)
                elif kind == "shop":  # boutique : panneau brun-doré avec icônes colorées
                    x0, y0, x1, y1 = int(W * 0.1), int(H * 0.08), int(W * 0.75), int(H * 0.75)
                    frame[y0:y1, x0:x1] = (40, 55, 70)
                    for q in range(24):
                        xx, yy = x0 + 20 + (q % 8) * 50, y0 + 30 + (q // 8) * 60
                        cv2.rectangle(frame, (xx, yy), (xx + 36, yy + 36), tuple(int(v) for v in RNG.integers(40, 255, 3)), -1)
                elif kind == "black":  # fondu au noir (chargement, coupure)
                    frame[:] = 0
        # Interface du bas (reste en couleur, même mort)
        hud_y = int(H * 0.86)
        cv2.rectangle(frame, (int(W * 0.3), hud_y), (int(W * 0.7), H), (35, 30, 25), -1)
        for q in range(6):
            cv2.rectangle(frame, (int(W * 0.32) + q * (H // 14), hud_y + 8), (int(W * 0.32) + q * (H // 14) + H // 18, hud_y + 8 + H // 18), (40 + q * 30, 160, 220 - q * 25), -1)
        # Minimap : cadre doré, carte assombrie, points des champions
        frame[my:my + side, mx:mx + side] = minimap_tex
        cv2.rectangle(frame, (mx, my), (mx + side - 1, my + side - 1), (70, 160, 200), max(2, side // 60))
        for (px, py, sp, ph, blue) in champs:
            x = mx + int(side * (0.1 + 0.8 * (0.5 + 0.5 * math.sin(t * sp * 0.3 + ph))))
            y = my + int(side * (0.1 + 0.8 * (0.5 + 0.5 * math.cos(t * sp * 0.3 + ph))))
            cv2.circle(frame, (x, y), max(2, side // 40), (230, 140, 40) if blue else (40, 40, 230), -1)
        if sc.get("webcam"):  # webcam de streamer, très colorée, en haut à gauche
            wx, wy, ww, wh = int(W * 0.02), int(H * 0.04), int(W * 0.24), int(H * 0.27)
            hue = int((t * 40) % 180)
            cam = np.full((wh, ww, 3), (hue, 200, 220), np.uint8)
            frame[wy:wy + wh, wx:wx + ww] = cv2.cvtColor(cam, cv2.COLOR_HSV2BGR)
            cv2.circle(frame, (wx + ww // 2, wy + wh // 2), wh // 3, (90, 140, 230), -1)
        if sc.get("chat"):  # chat de stream, colonne de lignes colorées
            for q in range(12):
                yy = int(H * 0.35) + q * 14
                cv2.rectangle(frame, (6, yy), (6 + int(W * 0.18), yy + 8), (200, 80 + (q * 37) % 150, 255 - q * 15), -1)
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    proc.wait()
    ow, oh = sc["out"]
    # Zone minimap en coordonnées normalisées de la vidéo produite (mise à l'échelle uniforme)
    return {"x": mx / W, "y": my / H, "w": side / W, "h": side / H}


SCENARIOS = [
    {"name": "00-test-court", "dur": 20, "out": (1280, 720), "deaths": [(8, 15)]},  # utilisé par les tests de l'appli
    {"name": "01-base-1080p", "deaths": [(14, 22), (41, 50)]},
    {"name": "02-720p", "out": (1280, 720), "deaths": [(10, 17)]},
    {"name": "03-1440p", "out": (2560, 1440), "deaths": [(20, 28)]},
    {"name": "04-60fps", "fps": 60, "dur": 40, "deaths": [(12, 19)]},
    {"name": "05-compression-forte", "crf": 36, "deaths": [(15, 23), (38, 46)]},
    {"name": "06-webcam-chat", "webcam": True, "chat": True, "deaths": [(9, 12.2), (28, 29.5)], "dur": 30},  # comme ton clip de stream
    {"name": "07-mort-courte-2s", "deaths": [(20, 22.2)]},
    {"name": "08-mort-coupee-fin", "dur": 40, "deaths": [(38.2, 45)]},
    {"name": "09-morts-rapprochees", "deaths": [(10, 16), (21, 28), (33, 40)]},
    {"name": "10-ultra-large", "internal": (1120, 480), "out": (2560, 1080), "deaths": [(16, 24)]},
    {"name": "11-minimap-gauche", "mm_side": "left", "deaths": [(18, 25)]},
    {"name": "12-petite-minimap", "mm_size": 0.20, "deaths": [(25, 31)]},
    {"name": "13-grande-minimap", "mm_size": 0.34, "deaths": [(12, 20)]},
    {"name": "14-piege-scene-sombre", "traps": [{"kind": "dark", "from": 10, "to": 18}]},
    {"name": "15-piege-tableau-scores", "traps": [{"kind": "scoreboard", "from": 12, "to": 16}], "deaths": [(30, 37)]},
    {"name": "16-piege-boutique", "traps": [{"kind": "shop", "from": 8, "to": 15}], "deaths": [(33, 40)]},
    {"name": "17-piege-fondu-noir", "traps": [{"kind": "black", "from": 20, "to": 21.2}], "deaths": [(35, 42)]},
    {"name": "18-aucune-mort", "deaths": []},
    {"name": "19-webcam-compression", "webcam": True, "crf": 34, "deaths": [(15, 21)]},
    {"name": "20-60fps-webcam-chat", "fps": 60, "dur": 35, "webcam": True, "chat": True, "deaths": [(8, 13), (24, 30)]},
]


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "bench-corpus"
    only = set(sys.argv[2:])
    os.makedirs(out_dir, exist_ok=True)
    labels = {}
    for i, sc in enumerate(SCENARIOS):
        if only and sc["name"] not in only:
            continue
        if not only and sc["name"].startswith("00-"):
            continue
        sc = {"fps": 30, "dur": 55, "out": (1920, 1080), "internal": (640, 360), "seed": i + 1, **sc}
        if sc["out"][0] >= 2560 and "internal" not in SCENARIOS[i]:
            sc["internal"] = (960, 540)
        sc["deaths"] = [(a, min(b, sc["dur"])) for a, b in sc.get("deaths", [])]
        path = os.path.join(out_dir, f"{sc['name']}.mp4")
        mm = render(path, sc)
        labels[f"{sc['name']}.mp4"] = {"deaths": [a for a, _ in sc["deaths"]], "minimap": mm, "traps": sc.get("traps", [])}
        print("✓", sc["name"], flush=True)
    with open(os.path.join(out_dir, "labels.json"), "w") as f:
        json.dump(labels, f, indent=1)


if __name__ == "__main__":
    main()
