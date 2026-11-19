// Plan du récap : regroupe les moments dont les extraits se chevauchent, pour ne jamais montrer
// deux fois les mêmes images (fonction pure, testée).
export type PlanMoment = { id: string; contextStartMs: number; endMs: number; decisionMs: number };
export type Segment<M extends PlanMoment> = { startMs: number; endMs: number; moments: M[] };

export function planSegments<M extends PlanMoment>(moments: M[], opts: { maxSegmentMs: number; durationMs: number }): Segment<M>[] {
  const sorted = [...moments].sort((a, b) => a.contextStartMs - b.contextStartMs || a.decisionMs - b.decisionMs);
  const out: Segment<M>[] = [];
  for (const m of sorted) {
    const end = Math.min(m.endMs, m.contextStartMs + opts.maxSegmentMs, opts.durationMs);
    const last = out.at(-1);
    if (last && m.contextStartMs < last.endMs && Math.max(last.endMs, end) - last.startMs <= opts.maxSegmentMs + 15_000) {
      // Chevauchement : un seul extrait qui contient les deux moments (pauses comprises).
      last.endMs = Math.max(last.endMs, end);
      last.moments.push(m);
      continue;
    }
    // Pas de fusion possible : l'extrait suivant commence où le précédent s'arrête (aucune image répétée).
    const start = last ? Math.max(m.contextStartMs, last.endMs) : m.contextStartMs;
    if (end - start < 1500) {
      if (last) last.moments.push(m); // moment entièrement déjà montré : rattaché au précédent
      continue;
    }
    out.push({ startMs: start, endMs: end, moments: [m] });
  }
  for (const s of out) s.moments.sort((a, b) => a.decisionMs - b.decisionMs);
  return out;
}
