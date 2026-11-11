// « As-tu porté ton équipe ou t'es-tu fait porter ? » — comparaison de ta note CoachGG à celle
// de tes coéquipiers, partie par partie (fonctions pures, testées). Données mesurées uniquement.
export type ImpactGame = { matchId: string; win: boolean; myScore: number; mateScores: number[]; killParticipation: number | null; mvpVotes: number };

export type ImpactKind = "CARRY" | "CARRIED" | "FOUGHT" | "STRUGGLED" | "EVEN";
export const IMPACT_LABELS: Record<ImpactKind, string> = {
  CARRY: "Tu as porté ton équipe",
  CARRIED: "Tu t'es fait porter",
  FOUGHT: "Défaite malgré une bonne partie",
  STRUGGLED: "Partie difficile",
  EVEN: "Dans la moyenne de ton équipe",
};

const MARGIN = 1; // écart de note (sur 10) au-dessus duquel la différence est nette

export function classifyGame(g: ImpactGame): { kind: ImpactKind; gap: number; rank: number } | null {
  if (g.mateScores.length < 2) return null; // trop peu de coéquipiers notés pour comparer
  const avg = g.mateScores.reduce((a, b) => a + b, 0) / g.mateScores.length;
  const gap = Math.round((g.myScore - avg) * 10) / 10;
  const rank = 1 + g.mateScores.filter((s) => s > g.myScore).length;
  const kind: ImpactKind = gap >= MARGIN ? (g.win ? "CARRY" : "FOUGHT") : gap <= -MARGIN ? (g.win ? "CARRIED" : "STRUGGLED") : "EVEN";
  return { kind, gap, rank };
}

export function impactSummary(games: ImpactGame[]) {
  const rated = games.map((g) => ({ g, c: classifyGame(g) })).filter((x): x is { g: ImpactGame; c: NonNullable<ReturnType<typeof classifyGame>> } => !!x.c);
  const counts = { CARRY: 0, CARRIED: 0, FOUGHT: 0, STRUGGLED: 0, EVEN: 0 } as Record<ImpactKind, number>;
  for (const { c } of rated) counts[c.kind]++;
  const n = rated.length;
  const wins = rated.filter((x) => x.g.win).length;
  const bestInTeam = rated.filter((x) => x.c.rank === 1).length;
  const avgGap = n ? Math.round((rated.reduce((a, x) => a + x.c.gap, 0) / n) * 10) / 10 : null;
  const mvpVotes = games.reduce((a, g) => a + g.mvpVotes, 0);

  let verdict: { kind: "CARRY" | "CARRIED" | "BALANCED" | "UNKNOWN"; title: string; detail: string };
  if (n < 5) verdict = { kind: "UNKNOWN", title: "Pas encore assez de parties", detail: `Il faut au moins 5 parties où tes coéquipiers sont notés (actuellement ${n}). Les parties importées via Riot le permettent.` };
  else if (counts.CARRY / Math.max(1, wins) >= 0.4 || (counts.CARRY + counts.FOUGHT) / n >= 0.45)
    verdict = { kind: "CARRY", title: "Tu portes souvent ton équipe 💪", detail: `Meilleure note de ton équipe dans ${bestInTeam}/${n} parties, en moyenne ${avgGap! >= 0 ? "+" : ""}${avgGap} point(s) au-dessus de tes coéquipiers.` };
  else if (counts.CARRIED / Math.max(1, wins) >= 0.4 || (counts.CARRIED + counts.STRUGGLED) / n >= 0.45)
    verdict = {
      kind: "CARRIED",
      title: "Tu t'es souvent fait porter",
      detail: `Dans ${counts.CARRIED} de tes ${wins} victoires, ta note était nettement sous celle de tes coéquipiers (écart moyen ${avgGap} point(s)). Ce n'est pas un reproche : c'est là que tu as le plus à gagner.`,
    };
  else verdict = { kind: "BALANCED", title: "Tu tiens ta place dans l'équipe", detail: `Ta note est proche de celle de tes coéquipiers (écart moyen ${avgGap! >= 0 ? "+" : ""}${avgGap}), meilleure de l'équipe dans ${bestInTeam}/${n} parties.` };

  return { n, wins, counts, bestInTeam, avgGap, mvpVotes, verdict, games: rated.map(({ g, c }) => ({ matchId: g.matchId, win: g.win, ...c })) };
}
