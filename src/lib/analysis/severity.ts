// Gravité d'un moment : sert à garder les erreurs qui coûtent le plus quand il y en a trop pour le récap,
// et à annoncer les plus coûteuses en ouverture (fonction pure, testée).
type M = { kind: string; provenance: string; confidence: string; autoEvidence?: unknown };

const FLAG_WEIGHT: Record<string, number> = {
  objective_lost: 4, // la mort a coûté un objectif
  absent_fight: 3,
  absent_objective: 3, bad_back: 3, missed_back: 2, cs_drop: 2,
  level: 2,
  isolated: 2,
  outnumbered: 1,
  blind: 1,
  gold: 1,
  trade: -2, // un échange n'est pas forcément une erreur
};

export function severity(m: M): number {
  let s = m.kind === "MISTAKE" || m.kind === "MISSED_OPPORTUNITY" ? 3 : m.kind === "GOOD_ACTION" ? 0.5 : 1;
  if (m.provenance === "MANUAL") s += 3; // moment choisi par le joueur ou son coach
  if (m.confidence === "MEDIUM" || m.confidence === "HIGH") s += 0.5;
  for (const f of new Set(((m.autoEvidence ?? {}) as { flags?: string[] }).flags ?? [])) s += FLAG_WEIGHT[f] ?? 0;
  return s;
}

/** Garde les `max` moments les plus graves, rendus dans l'ordre chronologique. */
export function pickMoments<T extends M & { decisionMs: number }>(moments: T[], max: number): T[] {
  if (moments.length <= max) return [...moments].sort((a, b) => a.decisionMs - b.decisionMs);
  return [...moments]
    .map((m, i) => ({ m, i, s: severity(m) }))
    .sort((a, b) => b.s - a.s || a.m.decisionMs - b.m.decisionMs)
    .slice(0, max)
    .map((x) => x.m)
    .sort((a, b) => a.decisionMs - b.decisionMs);
}
