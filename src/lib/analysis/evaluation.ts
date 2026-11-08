// Évaluation de l'analyse assistée contre une vérité terrain (fonctions pures, testées).
//
// Une détection « écran grisé » est correcte si elle commence dans une fenêtre
// de tolérance autour d'une mort réelle. Appariement un-pour-un : chaque mort
// réelle ne valide qu'une seule détection (la plus proche).

export const DEFAULT_TOLERANCE_MS = 2500;

export type Detection = { startMs: number; endMs?: number; type?: string };
export type Truth = { videoMs: number; id?: string };

export type EvalResult = {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null; // tp / (tp + fp)
  recall: number | null; // tp / (tp + fn)
  f1: number | null;
  meanOffsetMs: number | null; // début de détection − mort réelle (positif = détecté après)
  pairs: { detectionMs: number; truthMs: number; offsetMs: number }[];
  falsePositives: number[];
  missed: number[];
};

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

export function evaluateDetections(
  detections: Detection[],
  truths: Truth[],
  opts: { toleranceMs?: number; rangeMs?: { from: number; to: number } } = {},
): EvalResult {
  const tol = opts.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  const inRange = (t: number) => !opts.rangeMs || (t >= opts.rangeMs.from && t <= opts.rangeMs.to);
  const det = detections.filter((d) => inRange(d.startMs)).map((d) => d.startMs);
  const tru = truths.filter((t) => inRange(t.videoMs)).map((t) => t.videoMs);

  // Toutes les paires candidates, appariées de la plus proche à la plus éloignée.
  const candidates: { i: number; j: number; d: number }[] = [];
  det.forEach((dm, i) => tru.forEach((tm, j) => Math.abs(dm - tm) <= tol && candidates.push({ i, j, d: Math.abs(dm - tm) })));
  candidates.sort((a, b) => a.d - b.d || a.i - b.i);
  const usedD = new Set<number>();
  const usedT = new Set<number>();
  const pairs: EvalResult["pairs"] = [];
  for (const c of candidates) {
    if (usedD.has(c.i) || usedT.has(c.j)) continue;
    usedD.add(c.i);
    usedT.add(c.j);
    pairs.push({ detectionMs: det[c.i]!, truthMs: tru[c.j]!, offsetMs: det[c.i]! - tru[c.j]! });
  }
  pairs.sort((a, b) => a.truthMs - b.truthMs);
  const tp = pairs.length;
  const fp = det.length - tp;
  const fn = tru.length - tp;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision != null && recall != null && precision + recall > 0 ? Math.round(((2 * precision * recall) / (precision + recall)) * 1000) / 1000 : null;
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    meanOffsetMs: tp ? Math.round(pairs.reduce((a, p) => a + p.offsetMs, 0) / tp) : null,
    pairs,
    falsePositives: det.filter((_, i) => !usedD.has(i)),
    missed: tru.filter((_, j) => !usedT.has(j)),
  };
}

/** Agrégat sur plusieurs vidéos (somme des TP/FP/FN, pas moyenne des ratios). */
export function aggregate(results: Pick<EvalResult, "tp" | "fp" | "fn" | "meanOffsetMs">[]) {
  const tp = results.reduce((a, r) => a + r.tp, 0);
  const fp = results.reduce((a, r) => a + r.fp, 0);
  const fn = results.reduce((a, r) => a + r.fn, 0);
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const offsets = results.filter((r) => r.meanOffsetMs != null && r.tp > 0);
  return {
    videos: results.length,
    tp,
    fp,
    fn,
    precision,
    recall,
    f1: precision != null && recall != null && precision + recall > 0 ? Math.round(((2 * precision * recall) / (precision + recall)) * 1000) / 1000 : null,
    meanOffsetMs: offsets.length ? Math.round(offsets.reduce((a, r) => a + r.meanOffsetMs! * r.tp, 0) / offsets.reduce((a, r) => a + r.tp, 0)) : null,
  };
}

/** Morts du joueur issues de la timeline MATCH-V5, converties en temps vidéo. */
export function deathsFromTimeline(
  timeline: { metadata: { participants: string[] }; info: { frames: { events: { type: string; timestamp: number; victimId?: number }[] }[] } },
  puuid: string,
  gameStartOffsetMs: number,
): number[] {
  const participantId = timeline.metadata.participants.indexOf(puuid) + 1;
  if (participantId <= 0) return [];
  return timeline.info.frames
    .flatMap((f) => f.events)
    .filter((e) => e.type === "CHAMPION_KILL" && e.victimId === participantId)
    .map((e) => e.timestamp + gameStartOffsetMs)
    .filter((t) => t >= 0)
    .sort((a, b) => a - b);
}
