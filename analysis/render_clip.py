#!/usr/bin/env python3
"""CoachGG — export d'un clip avec ses corrections incrustées.

Reproduit le parcours du lecteur de coaching dans un MP4 :
contexte → ralenti → pause à la décision (l'alternative se dessine, explication
affichée) → conséquence. Mêmes règles de dessin que le lecteur web :
couleur + forme + libellé pour chaque style, apparition progressive, fondu de sortie.

Entrée : fichier JSON (voir build_spec côté serveur). Sortie : MP4 H.264.
Progression sur stderr : « PROGRESS <0-100> ».
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

OUT_W = 1280
FPS = 30
FREEZE_SEC = 5.0
ALT_DRAW_SEC = 1.8

COLORS = {
    "actual": (240, 82, 82),
    "alternative": (49, 196, 141),
    "danger": (255, 138, 76),
    "ally": (63, 131, 248),
    "enemy": (240, 82, 82),
    "neutral": (229, 231, 235),
}
STYLE_LABEL = {
    "actual": "Trajet réel",
    "alternative": "Alternative (proposition)",
    "danger": "Zone dangereuse",
    "ally": "Allié",
    "enemy": "Ennemi visible",
    "neutral": "Repère",
}


def font(size: int, bold: bool = False):
    for p in (os.environ.get("RENDER_FONT", ""), "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf"):
        if p and os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def progress(msg: float):
    print(f"PROGRESS {int(max(0, min(100, msg)))}", file=sys.stderr, flush=True)


# ───────────────────────── géométrie (identique au lecteur) ─────────────────────────

def draw_progress(a: dict, t: float, draw_ms: float = 1500) -> float:
    if t < a["startMs"]:
        return 0.0
    d = max(1.0, min(draw_ms, (a["endMs"] - a["startMs"]) * 0.6))
    return min(1.0, (t - a["startMs"]) / d)


def fade(a: dict, t: float, fade_ms: float = 300) -> float:
    if t < a["startMs"] or t > a["endMs"]:
        return 0.0
    left = a["endMs"] - t
    return 1.0 if left >= fade_ms else max(0.0, left / fade_ms)


def point_along(pts, f):
    if len(pts) == 1 or f <= 0:
        return pts[0], [pts[0]]
    total = sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))
    target = min(1.0, f) * total
    out = [pts[0]]
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        seg = math.dist(a, b)
        if target <= seg:
            k = 0 if seg == 0 else target / seg
            p = (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)
            out.append(p)
            return p, out
        target -= seg
        out.append(b)
    return pts[-1], out


class Space:
    def __init__(self, w: int, h: int, minimap):
        self.w, self.h, self.mm = w, h, minimap

    def rect(self, space: str):
        if space == "MINIMAP" and self.mm:
            m = self.mm
            return (m["x"] * self.w, m["y"] * self.h, m["w"] * self.w, m["h"] * self.h)
        return (0.0, 0.0, float(self.w), float(self.h))

    def pt(self, p, space):
        x, y, w, h = self.rect(space)
        return (x + p["x"] * w, y + p["y"] * h)

    def r(self, r, space):
        return r * self.rect(space)[2]


# ───────────────────────────────── dessin ─────────────────────────────────

def dashed(d: ImageDraw.ImageDraw, pts, color, width, dash=14, gap=9):
    for i in range(1, len(pts)):
        (x1, y1), (x2, y2) = pts[i - 1], pts[i]
        seg = math.dist((x1, y1), (x2, y2))
        n = 0.0
        while n < seg:
            e = min(seg, n + dash)
            k1, k2 = n / seg, e / seg
            d.line([(x1 + (x2 - x1) * k1, y1 + (y2 - y1) * k1), (x1 + (x2 - x1) * k2, y1 + (y2 - y1) * k2)], fill=color, width=width)
            n = e + gap


def tag(d: ImageDraw.ImageDraw, xy, text, color, f, anchor="l"):
    x, y = xy
    bbox = d.textbbox((0, 0), text, font=f)
    w, h = bbox[2] - bbox[0] + 14, bbox[3] - bbox[1] + 10
    if anchor == "m":
        x -= w / 2
    d.rounded_rectangle([x, y - h / 2, x + w, y + h / 2], radius=5, fill=(10, 13, 20, 225), outline=color + (255,), width=1)
    d.text((x + 7, y - h / 2 + 4), text, font=f, fill=(255, 255, 255, 255))


def arrow_head(d, tip, frm, color, size=12):
    ang = math.atan2(tip[1] - frm[1], tip[0] - frm[0])
    p1 = (tip[0] - size * math.cos(ang - 0.45), tip[1] - size * math.sin(ang - 0.45))
    p2 = (tip[0] - size * math.cos(ang + 0.45), tip[1] - size * math.sin(ang + 0.45))
    d.polygon([tip, p1, p2], fill=color + (255,))


def draw_annotation(layer: Image.Image, a: dict, prog: float, alpha: float, sp: Space, f):
    d = ImageDraw.Draw(layer)
    style, space = a["style"], a.get("space", "FRAME")
    col = COLORS.get(style, (255, 255, 255))
    rgba = col + (int(255 * alpha),)
    small = space == "MINIMAP"
    width = 3 if small else 5
    g = a["geometry"]
    label = a.get("label") or (
        "Position conseillée" if a["type"] == "marker" else "Clic conseillé — non observé" if a["type"] == "click" else STYLE_LABEL.get(style, "")
    )
    if a["type"] == "path":
        pts = [sp.pt(p, space) for p in g["points"]]
        head, drawn = point_along(pts, prog)
        if len(drawn) >= 2:
            d.line(drawn, fill=(0, 0, 0, int(120 * alpha)), width=width + 3, joint="curve")
            if style == "alternative":
                dashed(d, drawn, rgba, width)
            else:
                d.line(drawn, fill=rgba, width=width, joint="curve")
        s = 6 if small else 9
        d.ellipse([head[0] - s, head[1] - s, head[0] + s, head[1] + s], fill=(10, 13, 20, int(255 * alpha)), outline=rgba, width=2)
        if style == "actual":  # croix = trajet réel
            d.line([head[0] - s / 2, head[1] - s / 2, head[0] + s / 2, head[1] + s / 2], fill=rgba, width=2)
            d.line([head[0] + s / 2, head[1] - s / 2, head[0] - s / 2, head[1] + s / 2], fill=rgba, width=2)
        else:  # coche = alternative
            d.line([head[0] - s / 2, head[1], head[0] - s / 8, head[1] + s / 2.5, head[0] + s / 1.6, head[1] - s / 2.2], fill=rgba, width=2)
        if prog >= 1 and not small:
            tag(d, (head[0] + 14, head[1] - 16), label, col, f)
    elif a["type"] == "arrow":
        p1, p2 = sp.pt(g["from"], space), sp.pt(g["to"], space)
        tip = (p1[0] + (p2[0] - p1[0]) * prog, p1[1] + (p2[1] - p1[1]) * prog)
        (dashed if style == "alternative" else (lambda dd, pp, c, w: dd.line(pp, fill=c, width=w)))(d, [p1, tip], rgba, width)
        arrow_head(d, tip, p1, col)
        if prog >= 1 and a.get("label"):
            tag(d, (tip[0] + 12, tip[1] - 12), a["label"], col, f)
    elif a["type"] in ("zone", "highlight"):
        c = sp.pt(g["center"] if a["type"] == "zone" else g["at"], space)
        r = sp.r(g["r"], space) * (min(1.0, 0.3 + prog) if a["type"] == "zone" else 1.0)
        box = [c[0] - r, c[1] - r, c[0] + r, c[1] + r]
        if a["type"] == "zone":
            hatch = Image.new("RGBA", layer.size, (0, 0, 0, 0))
            hd = ImageDraw.Draw(hatch)
            step = 10
            for k in range(int(-2 * r), int(2 * r), step):
                hd.line([(c[0] + k - r, c[1] + r), (c[0] + k + r, c[1] - r)], fill=col + (int(140 * alpha),), width=3)
            mask = Image.new("L", layer.size, 0)
            ImageDraw.Draw(mask).ellipse(box, fill=255)
            layer.paste(hatch, (0, 0), mask)
            d.ellipse(box, outline=rgba, width=2)
            if style == "danger":  # triangle « ! »
                t = (c[0], c[1] - r)
                d.polygon([(t[0], t[1] - 12), (t[0] + 11, t[1] + 8), (t[0] - 11, t[1] + 8)], fill=(10, 13, 20, 255), outline=rgba)
                d.text((t[0] - 3, t[1] - 7), "!", font=f, fill=rgba)
            if prog >= 1:
                tag(d, (c[0], c[1] + r + 16), label, col, f, anchor="m")
        else:
            d.ellipse(box, outline=col + (int(255 * alpha * prog),), width=3)
            if style == "enemy":
                for ang in (0, 90, 180, 270):
                    rad = math.radians(ang)
                    d.line([(c[0] + (r - 6) * math.sin(rad), c[1] - (r - 6) * math.cos(rad)), (c[0] + (r + 6) * math.sin(rad), c[1] - (r + 6) * math.cos(rad))], fill=rgba, width=3)
            if prog >= 1:
                tag(d, (c[0], c[1] - r - 16), label, col, f, anchor="m")
    elif a["type"] == "marker":
        p = sp.pt(g["at"], space)
        s = (7 if small else 12) * min(1.0, 0.4 + prog)
        d.polygon([(p[0], p[1] - s), (p[0] + s, p[1]), (p[0], p[1] + s), (p[0] - s, p[1])], fill=col + (int(90 * alpha),), outline=rgba, width=3)
        if prog >= 1:
            tag(d, (p[0] + s + 8, p[1]), label, col, f)
    elif a["type"] == "click":
        p = sp.pt(g["at"], space)
        d.ellipse([p[0] - 14, p[1] - 14, p[0] + 14, p[1] + 14], outline=rgba, width=3)
        d.ellipse([p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4], fill=rgba)
        cur = [(p[0] + 6, p[1] + 6), (p[0] + 6, p[1] + 22), (p[0] + 10, p[1] + 18), (p[0] + 14, p[1] + 26), (p[0] + 17, p[1] + 24.5), (p[0] + 13, p[1] + 16.5), (p[0] + 19, p[1] + 16.5)]
        d.polygon(cur, fill=(255, 255, 255, int(255 * alpha)), outline=(0, 0, 0, int(255 * alpha)))
        if prog >= 1:
            tag(d, (p[0] + 24, p[1] + 14), (a.get("label") + " (conseillé)") if a.get("label") else label, col, f)
    elif a["type"] == "text":
        p = sp.pt(g["at"], space)
        tag(d, p, a.get("label") or "", col, f)


def wrap(d, text, f, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if d.textlength(test, font=f) <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def explanation_panel(layer, m, fonts, w, h):
    d = ImageDraw.Draw(layer)
    pw = min(560, int(w * 0.46))
    x0, y0 = w - pw - 24, 70
    body = fonts["body"]
    lines = []
    lines.append(("title", m.get("title", "")))
    if m.get("observation"):
        lines.append(("label", "Observé"))
        lines += [("body", l) for l in wrap(d, m["observation"], body, pw - 32)]
    if m.get("alternative"):
        lines.append(("label", "Alternative proposée"))
        lines += [("alt", l) for l in wrap(d, m["alternative"], body, pw - 32)]
    if m.get("advice"):
        lines.append(("label", "Conseil"))
        lines += [("body", l) for l in wrap(d, m["advice"], body, pw - 32)]
    lines.append(("muted", f"{m.get('confidence', '')} · une alternative est une proposition, pas une certitude"))
    heights = {"title": 30, "label": 24, "body": 22, "alt": 22, "muted": 20}
    ph = 24 + sum(heights[k] for k, _ in lines)
    d.rounded_rectangle([x0, y0, x0 + pw, y0 + ph], radius=12, fill=(10, 13, 20, 230), outline=(76, 157, 255, 255), width=2)
    y = y0 + 14
    for kind, text in lines:
        if kind == "title":
            d.text((x0 + 16, y), text, font=fonts["title"], fill=(255, 255, 255, 255))
        elif kind == "label":
            d.text((x0 + 16, y + 4), text.upper(), font=fonts["small"], fill=(139, 149, 168, 255))
        elif kind == "alt":
            d.text((x0 + 16, y), text, font=body, fill=(49, 196, 141, 255))
        elif kind == "muted":
            d.text((x0 + 16, y + 2), text, font=fonts["small"], fill=(139, 149, 168, 255))
        else:
            d.text((x0 + 16, y), text, font=body, fill=(230, 233, 239, 255))
        y += heights[kind]


def banner(layer, text, f, color=(76, 157, 255)):
    d = ImageDraw.Draw(layer)
    bbox = d.textbbox((0, 0), text, font=f)
    d.rounded_rectangle([16, 14, 16 + bbox[2] + 24, 14 + bbox[3] + 16], radius=8, fill=(10, 13, 20, 215), outline=color + (255,), width=1)
    d.text((28, 20), text, font=f, fill=(255, 255, 255, 255))


def footer(layer, text, f):
    d = ImageDraw.Draw(layer)
    w, h = layer.size
    bbox = d.textbbox((0, 0), text, font=f)
    d.rounded_rectangle([w - bbox[2] - 34, h - bbox[3] - 26, w - 12, h - 10], radius=6, fill=(10, 13, 20, 190))
    d.text((w - bbox[2] - 23, h - bbox[3] - 20), text, font=f, fill=(170, 179, 197, 255))


# ───────────────────────────────── rendu ─────────────────────────────────

def render(spec: dict):
    src_w, src_h = spec["width"], spec["height"]
    out_w = min(OUT_W, src_w - src_w % 2)
    out_h = int(round(out_w * src_h / src_w / 2) * 2)
    start, end = spec["startMs"], spec["endMs"]
    sp = Space(out_w, out_h, spec.get("minimap"))
    fonts = {"tag": font(15), "body": font(17), "title": font(20, True), "small": font(13), "banner": font(17, True)}
    ffmpeg = spec.get("ffmpeg", "ffmpeg")
    dec = subprocess.Popen(
        [ffmpeg, "-v", "error", "-nostdin", "-ss", f"{start / 1000:.3f}", "-i", spec["video"], "-t", f"{(end - start) / 1000:.3f}",
         "-vf", f"fps={FPS},scale={out_w}:{out_h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    enc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{out_w}x{out_h}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", spec["out"]],
        stdin=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    anns = spec.get("annotations", [])
    moments = sorted(spec.get("moments", []), key=lambda m: m["decisionMs"])
    frame_bytes = out_w * out_h * 3
    total_src = max(1, int((end - start) / 1000 * FPS))
    seen: set[str] = set()
    n = 0
    written = 0

    def emit(img: Image.Image, t: float, freeze=None):
        nonlocal written
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        for a in anns:
            if freeze and a.get("recommendationId") == freeze["id"] and a["startMs"] <= freeze["decisionMs"] + 50 and a["endMs"] >= freeze["decisionMs"] - 50:
                prog = min(1.0, freeze["elapsed"] / ALT_DRAW_SEC) if a["style"] == "alternative" else 1.0
                alpha = 1.0
            else:
                alpha = fade(a, t)
                if alpha <= 0:
                    continue
                prog = draw_progress(a, t)
            draw_annotation(layer, a, prog, alpha, sp, fonts["tag"])
        m = next((m for m in moments if m["contextStartMs"] <= t <= m["endMs"]), None)
        if freeze:
            banner(layer, f"Pause · moment de décision — {freeze['title']}", fonts["banner"], (251, 191, 36))
            if freeze["elapsed"] >= 0.6:
                explanation_panel(layer, freeze, fonts, out_w, out_h)
        elif m:
            if t < m["slowdownStartMs"]:
                banner(layer, f"Contexte avant l'action — {m['title']}", fonts["banner"])
            elif t < m["decisionMs"]:
                banner(layer, f"Ralenti ×{str(m['slowdownRate']).replace('.', ',')} — {m['title']}", fonts["banner"])
            else:
                banner(layer, f"Conséquence — {m['title']}", fonts["banner"])
        footer(layer, spec.get("footer", "CoachGG"), fonts["small"])
        out = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
        enc.stdin.write(out.tobytes())
        written += 1

    assert dec.stdout is not None and enc.stdin is not None
    while True:
        buf = dec.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        t = start + n * 1000 / FPS
        img = Image.frombytes("RGB", (out_w, out_h), buf)
        # Pause pédagogique au franchissement de la décision
        for m in moments:
            if m["id"] not in seen and t >= m["decisionMs"] and t - 1000 / FPS < m["decisionMs"]:
                seen.add(m["id"])
                for k in range(int(FREEZE_SEC * FPS)):
                    emit(img, m["decisionMs"], {**m, "elapsed": k / FPS})
        slow = next((m for m in moments if m["slowdownStartMs"] <= t < m["decisionMs"]), None)
        repeats = max(1, round(1 / slow["slowdownRate"])) if slow else 1
        for _ in range(repeats):
            emit(img, t)
        n += 1
        if n % 15 == 0:
            progress(100 * n / total_src)
    dec.wait()
    enc.stdin.close()
    enc.wait()
    if n == 0 or enc.returncode != 0:
        raise RuntimeError("Rendu impossible (aucune image décodée ou encodage échoué).")
    return {"frames": written, "durationSec": round(written / FPS, 2), "width": out_w, "height": out_h}


if __name__ == "__main__":
    try:
        with open(sys.argv[1], encoding="utf-8") as fh:
            result = render(json.load(fh))
        json.dump(result, sys.stdout)
        progress(100)
    except Exception as e:  # message lisible pour le worker
        print(f"ERROR {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)
