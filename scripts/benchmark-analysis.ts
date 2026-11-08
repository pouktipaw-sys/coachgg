// Banc d'essai hors ligne de l'analyse assistée sur un jeu de vidéos étiquetées.
//
//   npm run benchmark:analysis -- <dossier> [--tolerance 2.5] [--out rapport.json]
//
// Le dossier contient les vidéos et un fichier labels.json :
//   {
//     "partie1.mp4": { "deaths": ["3:12", "11:40.5", 1295.2], "minimap": { "x": 0.81, "y": 0.69, "w": 0.19, "h": 0.31 } },
//     "partie2.mp4": { "deaths": [] }
//   }
// Les morts sont en temps VIDÉO (« m:ss », « m:ss.s » ou secondes). « minimap » est facultatif.
// Aucune base de données, aucun envoi réseau : tout reste sur la machine.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probe } from "../src/server/video/ffmpeg";
import { runAnalyzer } from "../src/server/analysis/runner";
import { aggregate, evaluateDetections, DEFAULT_TOLERANCE_MS } from "../src/lib/analysis/evaluation";
import { RULES_VERSION } from "../src/lib/analysis/rules";

type Label = { deaths: (string | number)[]; minimap?: { x: number; y: number; w: number; h: number } };

export function parseTime(t: string | number): number {
  if (typeof t === "number") return Math.round(t * 1000);
  const m = t.trim().match(/^(?:(\d+):)?(\d+):(\d{2}(?:\.\d+)?)$/);
  if (!m) throw new Error(`Horodatage invalide : ${t}`);
  return Math.round(((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000);
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) throw new Error("Usage : npm run benchmark:analysis -- <dossier> [--tolerance 2.5] [--out rapport.json]");
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const toleranceMs = opt("--tolerance") ? Math.round(Number(opt("--tolerance")) * 1000) : DEFAULT_TOLERANCE_MS;
  const labels = JSON.parse(await readFile(path.join(dir, "labels.json"), "utf8")) as Record<string, Label>;

  const rows: Record<string, unknown>[] = [];
  const results = [];
  for (const [file, label] of Object.entries(labels)) {
    const video = path.resolve(dir, file);
    const tmp = await mkdtemp(path.join(os.tmpdir(), "coachgg-bench-"));
    const t0 = Date.now();
    try {
      const meta = await probe(video);
      const out = await runAnalyzer({
        video,
        outDir: tmp,
        width: meta.width,
        height: meta.height,
        durationMs: meta.durationMs,
        contextSec: 10,
        minimap: label.minimap ?? null,
      });
      const r = evaluateDetections(
        out.events.filter((e) => e.type === "grey_screen"),
        label.deaths.map((d) => ({ videoMs: parseTime(d) })),
        { toleranceMs, rangeMs: { from: 0, to: meta.durationMs } },
      );
      results.push(r);
      rows.push({ file, durée: `${Math.round(meta.durationMs / 1000)} s`, morts: label.deaths.length, VP: r.tp, FP: r.fp, FN: r.fn, précision: r.precision, rappel: r.recall, "décalage (ms)": r.meanOffsetMs, "temps (s)": Math.round((Date.now() - t0) / 100) / 10 });
    } catch (e) {
      rows.push({ file, erreur: e instanceof Error ? e.message : String(e) });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  const total = aggregate(results);
  console.log(`\nCoachGG — banc d'essai ${RULES_VERSION} (tolérance ±${toleranceMs / 1000} s)\n`);
  console.table(rows);
  console.log("Total :", total);
  if (total.videos < 20) console.log("⚠ Moins de 20 vidéos : résultat indicatif, pas une mesure fiable.");
  const outFile = opt("--out");
  if (outFile) {
    await writeFile(outFile, JSON.stringify({ version: RULES_VERSION, toleranceMs, date: new Date().toISOString(), rows, total }, null, 2));
    console.log(`Rapport écrit dans ${outFile}`);
  }
}

if (process.argv[1] && /benchmark-analysis\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
