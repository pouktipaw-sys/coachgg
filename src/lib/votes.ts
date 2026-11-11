// Votes entre coéquipiers après une partie : note /10, MVP, catégories (fonctions pures, testées).
export const AWARDS = [
  { key: "CARRY", label: "Carry", icon: "🔥" },
  { key: "TEAMFIGHT", label: "Roi du teamfight", icon: "⚔️" },
  { key: "VISION", label: "Maître de la vision", icon: "👁️" },
  { key: "SHOTCALL", label: "Shotcaller", icon: "📣" },
  { key: "CLUTCH", label: "Action décisive", icon: "⚡" },
  { key: "TEAMPLAY", label: "Meilleur soutien d'équipe", icon: "🤝" },
] as const;
export type AwardKey = (typeof AWARDS)[number]["key"];
export const AWARD_KEYS = AWARDS.map((a) => a.key) as [AwardKey, ...AwardKey[]];
export const AWARD_LABEL = Object.fromEntries(AWARDS.map((a) => [a.key, `${a.icon} ${a.label}`])) as Record<AwardKey, string>;

export type Vote = { voterId: string; targetId: string; score: number; mvp: boolean; awards: string[] };

export type Tally = {
  perTarget: Record<string, { avgScore: number | null; voters: number; mvpVotes: number; awards: Partial<Record<AwardKey, number>> }>;
  /** MVP élu : plus de votes MVP ; à égalité, meilleure note moyenne ; sinon égalité déclarée. */
  mvp: { targetId: string; votes: number } | { tie: string[] } | null;
  /** Gagnant de chaque catégorie (null si égalité ou aucun vote). */
  awards: Partial<Record<AwardKey, string | null>>;
  voters: number;
};

export function tallyVotes(votes: Vote[]): Tally {
  const perTarget: Tally["perTarget"] = {};
  const sums: Record<string, number> = {};
  for (const v of votes) {
    const t = (perTarget[v.targetId] ??= { avgScore: null, voters: 0, mvpVotes: 0, awards: {} });
    t.voters++;
    sums[v.targetId] = (sums[v.targetId] ?? 0) + v.score;
    if (v.mvp) t.mvpVotes++;
    for (const a of v.awards) if ((AWARD_KEYS as string[]).includes(a)) t.awards[a as AwardKey] = (t.awards[a as AwardKey] ?? 0) + 1;
  }
  for (const [id, t] of Object.entries(perTarget)) t.avgScore = Math.round((sums[id]! / t.voters) * 10) / 10;

  let mvp: Tally["mvp"] = null;
  const top = Math.max(0, ...Object.values(perTarget).map((t) => t.mvpVotes));
  if (top > 0) {
    let lead = Object.entries(perTarget).filter(([, t]) => t.mvpVotes === top);
    if (lead.length > 1) {
      const best = Math.max(...lead.map(([, t]) => t.avgScore ?? 0));
      lead = lead.filter(([, t]) => (t.avgScore ?? 0) === best);
    }
    mvp = lead.length === 1 ? { targetId: lead[0]![0], votes: top } : { tie: lead.map(([id]) => id) };
  }

  const awards: Tally["awards"] = {};
  for (const key of AWARD_KEYS) {
    const counts = Object.entries(perTarget).map(([id, t]) => [id, t.awards[key] ?? 0] as const).filter(([, n]) => n > 0);
    if (!counts.length) continue;
    const max = Math.max(...counts.map(([, n]) => n));
    const lead = counts.filter(([, n]) => n === max);
    awards[key] = lead.length === 1 ? lead[0]![0] : null;
  }
  return { perTarget, mvp, awards, voters: new Set(votes.map((v) => v.voterId)).size };
}

/** Contrôle d'un bulletin : un seul MVP, chaque catégorie attribuée au plus une fois, cibles autorisées. */
export function validateBallot(ballot: { targetId: string; mvp: boolean; awards: string[] }[], allowedTargets: string[]): string | null {
  if (ballot.filter((b) => b.mvp).length > 1) return "Un seul MVP par vote.";
  const seen = new Set<string>();
  for (const b of ballot) {
    if (!allowedTargets.includes(b.targetId)) return "Vous ne pouvez noter que vos coéquipiers de cette partie.";
    for (const a of b.awards) {
      if (!(AWARD_KEYS as string[]).includes(a)) return "Catégorie inconnue.";
      if (seen.has(a)) return "Chaque catégorie ne peut être attribuée qu'à un seul joueur.";
      seen.add(a);
    }
  }
  if (new Set(ballot.map((b) => b.targetId)).size !== ballot.length) return "Un joueur est noté deux fois.";
  return null;
}
