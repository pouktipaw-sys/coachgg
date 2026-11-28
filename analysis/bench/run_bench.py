"""Mesure l'analyse vidéo sur le banc d'essai (vidéos + labels.json de make_corpus.py, ou vraies vidéos étiquetées).

    python analysis/bench/run_bench.py <dossier> [--out rapport.json]

Pour chaque vidéo : morts trouvées / manquées / fausses alertes (tolérance 2,5 s, appariement un pour un),
écart sur le début de l'écran de mort (ms), et zone minimap détectée automatiquement (recouvrement IoU).
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ANALYZE = os.path.join(HERE, "..", "analyze.py")
TOL_MS = 2500


def probe(path: str):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path], capture_output=True, text=True).stdout
    j = json.loads(out)
    return j["streams"][0]["width"], j["streams"][0]["height"], float(j["format"]["duration"])


def iou(a, b):
    if not a or not b:
        return None
    x0, y0 = max(a["x"], b["x"]), max(a["y"], b["y"])
    x1, y1 = min(a["x"] + a["w"], b["x"] + b["w"]), min(a["y"] + a["h"], b["y"] + b["h"])
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0


def match(found_ms, truth_ms):
    """Appariement glouton un pour un par écart croissant."""
    pairs = sorted(((abs(f - t), i, j) for i, f in enumerate(found_ms) for j, t in enumerate(truth_ms) if abs(f - t) <= TOL_MS))
    used_f, used_t, errs = set(), set(), []
    for d, i, j in pairs:
        if i in used_f or j in used_t:
            continue
        used_f.add(i)
        used_t.add(j)
        errs.append(found_ms[i] - truth_ms[j])
    return len(errs), len(found_ms) - len(errs), len(truth_ms) - len(errs), errs


def main():
    d = sys.argv[1]
    out_path = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
    labels = json.load(open(os.path.join(d, "labels.json")))
    rows, tp, fp, fn, all_errs, ious = [], 0, 0, 0, [], []
    for name, lab in labels.items():
        path = os.path.join(d, name)
        w, h, dur = probe(path)
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run([sys.executable, ANALYZE, "--video", path, "--out", tmp, "--width", str(w), "--height", str(h), "--duration-ms", str(int(dur * 1000))], capture_output=True, text=True)
        if r.returncode != 0:
            print("ÉCHEC", name, r.stderr[-300:])
            continue
        res = json.loads(r.stdout)
        found = [e["startMs"] for e in res["events"] if e["type"] == "grey_screen"]
        truth = [int(t * 1000) for t in lab["deaths"]]
        a, b, c, errs = match(found, truth)
        guess = res.get("minimapGuess")
        mi = iou(guess, lab.get("minimap"))
        tp, fp, fn = tp + a, fp + b, fn + c
        all_errs += errs
        if mi is not None:
            ious.append(mi)
        rows.append({"video": name, "trouvées": a, "fausses": b, "manquées": c, "écart_ms": [int(e) for e in errs], "minimap_iou": None if mi is None else round(mi, 3)})
        print(f"{name:32s} trouvées {a}  fausses {b}  manquées {c}  écart {[int(e) for e in errs]} ms  minimap IoU {'—' if mi is None else round(mi, 3)}", flush=True)
    prec = tp / (tp + fp) if tp + fp else 1.0
    rec = tp / (tp + fn) if tp + fn else 1.0
    mae = sum(abs(e) for e in all_errs) / len(all_errs) if all_errs else 0
    summary = {
        "précision": round(prec, 3), "rappel": round(rec, 3), "morts": tp + fn, "trouvées": tp, "fausses_alertes": fp, "manquées": fn,
        "écart_moyen_ms": round(mae), "écart_max_ms": max((abs(e) for e in all_errs), default=0),
        "minimap_détectée": f"{sum(1 for i in ious if i >= 0.8)}/{len(labels)} (IoU ≥ 0,8)", "minimap_iou_moyen": round(sum(ious) / len(ious), 3) if ious else None,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if out_path:
        json.dump({"résumé": summary, "vidéos": rows}, open(out_path, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
