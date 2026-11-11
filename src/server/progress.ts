// Profil de progression et bilans (fonctions de lecture ; aucune donnée de démo).
import { prisma } from "./db";
import { notify } from "./notifications";
import { COMPONENT_LABELS, CURRENT_SCORE_CONFIG, type ComponentKey } from "@/lib/scoring/config";
import { impactSummary } from "@/lib/impact";

type Comp = { key: ComponentKey; available: boolean; score: number | null };
type Row = { date: Date; role: string | null; champion: string; win: boolean; overall: number; comps: Comp[]; matchId: string };

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (v: number[]) => (v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null);

async function scoredRows(userId: string): Promise<Row[]> {
  const ps = await prisma.performanceScore.findMany({
    where: { scoreVersionId: CURRENT_SCORE_CONFIG.version, overall: { not: null }, participant: { userId, match: { isDemo: false } } },
    include: { participant: { include: { match: { select: { id: true, gameStartAt: true, createdAt: true } } } } },
  });
  return ps
    .map((s) => ({
      date: s.participant.match.gameStartAt ?? s.participant.match.createdAt,
      role: s.participant.role,
      champion: s.participant.championName,
      win: s.participant.win,
      overall: s.overall!,
      comps: s.components as Comp[],
      matchId: s.participant.match.id,
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function componentAverages(rows: Pick<Row, "comps">[]) {
  return (Object.keys(COMPONENT_LABELS) as ComponentKey[])
    .map((key) => {
      const v = rows.map((r) => r.comps.find((c) => c.key === key)).filter((c) => c?.available && c.score != null).map((c) => c!.score!);
      return { key, label: COMPONENT_LABELS[key], avg: mean(v), n: v.length };
    })
    .filter((x): x is { key: ComponentKey; label: string; avg: number; n: number } => x.avg != null);
}

function groupBy<K extends string>(rows: Row[], key: (r: Row) => K) {
  const m = new Map<K, Row[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].map(([k, rs]) => ({ key: k, n: rs.length, avgScore: mean(rs.map((r) => r.overall))!, winrate: Math.round((rs.filter((r) => r.win).length / rs.length) * 100) }));
}

export async function progressProfile(userId: string) {
  const rows = await scoredRows(userId);
  const recent = rows.slice(0, 10);
  const previous = rows.slice(10, 20);
  const rec = componentAverages(recent);
  const prev = componentAverages(previous);
  const trends = rec.map((c) => {
    const p = prev.find((x) => x.key === c.key);
    return { ...c, previous: p?.avg ?? null, delta: p ? round1(c.avg - p.avg) : null };
  });
  const [goalsAchieved, momentsCount] = await Promise.all([
    prisma.goal.findMany({ where: { ownerId: userId, status: "ACHIEVED" }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.recommendation.count({ where: { recording: { ownerId: userId }, status: { in: ["PUBLISHED", "DISPUTED"] } } }),
  ]);
  return {
    total: rows.length,
    strengths: trends.filter((t) => t.avg >= 7 && t.n >= 2),
    weaknesses: trends.filter((t) => t.avg <= 5 && t.n >= 2),
    trends,
    history: [...rows].reverse().slice(-30).map((r) => ({ label: r.date.toLocaleDateString("fr-FR"), value: r.overall, matchId: r.matchId })),
    byRole: groupBy(rows, (r) => r.role ?? "INCONNU").sort((a, b) => b.n - a.n),
    byChampion: groupBy(rows, (r) => r.champion).sort((a, b) => b.n - a.n).slice(0, 10),
    goalsAchieved,
    momentsCount,
  };
}

/** Bilan des 7 derniers jours comparé aux 7 précédents. null si aucune activité. */
export async function weeklyReview(userId: string, now = new Date()) {
  const day = 86400_000;
  const from = new Date(now.getTime() - 7 * day);
  const prevFrom = new Date(now.getTime() - 14 * day);
  const rows = await scoredRows(userId);
  const week = rows.filter((r) => r.date >= from && r.date <= now);
  const prevWeek = rows.filter((r) => r.date >= prevFrom && r.date < from);
  const moments = await prisma.recommendation.count({ where: { recording: { ownerId: userId }, status: "PUBLISHED", createdAt: { gte: from } } });
  if (week.length === 0 && moments === 0) return null;
  const comps = componentAverages(week).sort((a, b) => b.avg - a.avg);
  const avg = mean(week.map((r) => r.overall));
  const prevAvg = mean(prevWeek.map((r) => r.overall));
  return {
    from,
    to: now,
    matches: week.length,
    wins: week.filter((r) => r.win).length,
    avgScore: avg,
    previousAvgScore: prevAvg,
    delta: avg != null && prevAvg != null ? round1(avg - prevAvg) : null,
    best: comps[0] ?? null,
    worst: comps.length > 1 ? comps[comps.length - 1]! : null,
    moments,
  };
}

export function reviewSummary(r: NonNullable<Awaited<ReturnType<typeof weeklyReview>>>) {
  return [
    `${r.matches} partie(s) notée(s), ${r.wins} victoire(s)`,
    r.avgScore != null ? `note moyenne ${r.avgScore}/10${r.delta != null ? ` (${r.delta >= 0 ? "+" : ""}${r.delta} vs semaine précédente)` : ""}` : null,
    r.best ? `point fort : ${r.best.label} (${r.best.avg}/10)` : null,
    r.worst && r.worst.avg < 6 ? `à travailler : ${r.worst.label} (${r.worst.avg}/10)` : null,
    r.moments ? `${r.moments} moment(s) de coaching publiés` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Worker : notifie chaque semaine les joueurs actifs de leur bilan (au plus une fois par 7 jours). */
export async function sendWeeklyReviews(now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400_000);
  const active = await prisma.matchParticipant.findMany({
    where: { userId: { not: null }, match: { isDemo: false, OR: [{ gameStartAt: { gte: since } }, { gameStartAt: null, createdAt: { gte: since } }] } },
    distinct: ["userId"],
    select: { userId: true },
  });
  let sent = 0;
  for (const { userId } of active) {
    const already = await prisma.notification.count({ where: { userId: userId!, type: "weekly_review", createdAt: { gte: new Date(now.getTime() - 6.5 * 86400_000) } } });
    if (already) continue;
    const r = await weeklyReview(userId!, now);
    if (!r) continue;
    await notify(userId!, { type: "weekly_review", title: "Votre bilan de la semaine", body: reviewSummary(r), link: "/app/progress" });
    sent++;
  }
  return sent;
}

/** Porteur ou porté : ta note comparée à celle de tes coéquipiers sur tes 20 dernières parties notées. */
export async function impactProfile(userId: string, take = 20) {
  const mine = await prisma.matchParticipant.findMany({
    where: { userId, match: { isDemo: false }, scores: { some: { scoreVersionId: CURRENT_SCORE_CONFIG.version, overall: { not: null } } } },
    include: {
      scores: { where: { scoreVersionId: CURRENT_SCORE_CONFIG.version } },
      match: { select: { gameStartAt: true, createdAt: true } },
      _count: { select: { votesReceived: { where: { mvp: true } } } },
    },
    orderBy: [{ match: { gameStartAt: "desc" } }, { createdAt: "desc" }],
    take,
  });
  const mates = await prisma.matchParticipant.findMany({
    where: { matchId: { in: mine.map((m) => m.matchId) }, id: { notIn: mine.map((m) => m.id) } },
    select: { matchId: true, teamSide: true, scores: { where: { scoreVersionId: CURRENT_SCORE_CONFIG.version }, select: { overall: true } } },
  });
  return impactSummary(
    mine.map((m) => ({
      matchId: m.matchId,
      win: m.win,
      myScore: m.scores[0]!.overall!,
      mateScores: mates.filter((x) => x.matchId === m.matchId && x.teamSide === m.teamSide).map((x) => x.scores[0]?.overall).filter((s): s is number => s != null),
      killParticipation: null,
      mvpVotes: m._count.votesReceived,
    })),
  );
}
