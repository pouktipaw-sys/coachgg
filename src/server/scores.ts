// Persistance des notes et des rapports de groupe (MVP).
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { CURRENT_SCORE_CONFIG, type Role, type ScoreConfig } from "@/lib/scoring/config";
import { computeProgression, computeScore, computeTeamMvp, type MvpEntry } from "@/lib/scoring/engine";

type TeamStats = Record<string, { kills?: number | null; damageToChampions?: number | null; damageToObjectives?: number | null }>;

export async function ensureScoreVersion(cfg: ScoreConfig = CURRENT_SCORE_CONFIG) {
  return prisma.scoreVersion.upsert({
    where: { id: cfg.version },
    update: {},
    create: { id: cfg.version, description: cfg.description, config: cfg as unknown as Prisma.InputJsonValue, experimental: cfg.experimental },
  });
}

/** Calcule (ou recalcule, idempotent) la note de chaque participant ayant des statistiques. */
export async function computeAndStoreScores(matchId: string, cfg: ScoreConfig = CURRENT_SCORE_CONFIG) {
  await ensureScoreVersion(cfg);
  const match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    include: { participants: { include: { statistics: true } } },
  });
  const teamStats = (match.teamStats ?? {}) as TeamStats;
  for (const p of match.participants) {
    if (!p.statistics) continue;
    const s = p.statistics;
    const r = computeScore(
      {
        role: (p.role as Role | null) ?? null,
        durationSec: match.durationSec,
        stats: s,
        team: teamStats[String(p.teamSide)] ?? {},
      },
      cfg,
    );
    const data = {
      overall: r.overall,
      components: r.components as unknown as Prisma.InputJsonValue,
      positives: r.positives as unknown as Prisma.InputJsonValue,
      negatives: r.negatives as unknown as Prisma.InputJsonValue,
      missingData: { items: r.missingData, reliabilityReasons: r.reliabilityReasons, availableWeight: r.availableWeight } as Prisma.InputJsonValue,
      reliability: r.reliability,
      computedAt: new Date(),
    };
    await prisma.performanceScore.upsert({
      where: { participantId_scoreVersionId: { participantId: p.id, scoreVersionId: cfg.version } },
      update: data,
      create: { participantId: p.id, scoreVersionId: cfg.version, ...data },
    });
  }
}

/** Historique de notes d'un joueur avant une date (même version ; même rôle si assez de parties). */
export async function scoreHistory(userId: string, before: Date, role: string | null, cfg: ScoreConfig = CURRENT_SCORE_CONFIG) {
  const rows = await prisma.performanceScore.findMany({
    where: {
      scoreVersionId: cfg.version,
      overall: { not: null },
      participant: { userId, match: { isDemo: false, OR: [{ gameStartAt: { lt: before } }, { gameStartAt: null, createdAt: { lt: before } }] } },
    },
    include: { participant: { select: { role: true } } },
    orderBy: { computedAt: "desc" },
    take: 20,
  });
  const sameRole = role ? rows.filter((r) => r.participant.role === role) : rows;
  const pick = sameRole.length >= 3 ? sameRole : rows;
  return { values: pick.slice(0, 10).map((r) => r.overall!), sameRole: pick === sameRole && !!role };
}

export async function progressionFor(userId: string, participantId: string, cfg: ScoreConfig = CURRENT_SCORE_CONFIG) {
  const p = await prisma.matchParticipant.findUniqueOrThrow({
    where: { id: participantId },
    include: { match: true, scores: { where: { scoreVersionId: cfg.version } } },
  });
  const current = p.scores[0]?.overall ?? null;
  const hist = await scoreHistory(userId, p.match.gameStartAt ?? p.match.createdAt, p.role, cfg);
  return { ...computeProgression(current, hist.values), sameRole: hist.sameRole };
}

/** Rapport de groupe pour un match : membres présents, notes comparables, MVP. */
export async function computeTeamReport(teamId: string, matchId: string, cfg: ScoreConfig = CURRENT_SCORE_CONFIG) {
  await ensureScoreVersion(cfg);
  const members = await prisma.teamMembership.findMany({ where: { teamId }, include: { user: { select: { id: true, displayName: true } } } });
  const memberIds = members.map((m) => m.userId);
  const participants = await prisma.matchParticipant.findMany({
    where: { matchId, userId: { in: memberIds } },
    include: { scores: { where: { scoreVersionId: cfg.version } }, match: { select: { isDemo: true } } },
  });
  if (participants.length < 2 || participants.some((p) => p.match.isDemo)) {
    await prisma.teamMatchReport.deleteMany({ where: { teamId, matchId } });
    return null;
  }
  const entries: MvpEntry[] = [];
  for (const p of participants) {
    const sc = p.scores[0];
    const prog = await progressionFor(p.userId!, p.id, cfg);
    entries.push({
      userId: p.userId!,
      displayName: members.find((m) => m.userId === p.userId)!.user.displayName,
      overall: sc?.overall ?? null,
      components: ((sc?.components ?? []) as { key: MvpEntry["components"][number]["key"]; score: number | null; available: boolean }[]).map((c) => ({
        key: c.key,
        score: c.score,
        available: c.available,
      })),
      progressionDelta: prog.available ? prog.delta : null,
    });
  }
  const mvp = computeTeamMvp(entries, cfg);
  const data = {
    presentUserIds: participants.map((p) => p.userId!),
    mvpUserIds: mvp.mvpUserIds,
    isTie: mvp.isTie,
    explanation: { text: mvp.explanation, ranking: mvp.ranking, excluded: mvp.excluded } as unknown as Prisma.InputJsonValue,
    distinctions: mvp.distinctions as unknown as Prisma.InputJsonValue,
    computedAt: new Date(),
  };
  return prisma.teamMatchReport.upsert({
    where: { teamId_matchId_scoreVersionId: { teamId, matchId, scoreVersionId: cfg.version } },
    update: data,
    create: { teamId, matchId, scoreVersionId: cfg.version, ...data },
  });
}

/** Recalcule les rapports de tous les groupes concernés par un match. */
export async function refreshTeamReportsForMatch(matchId: string) {
  const userIds = (await prisma.matchParticipant.findMany({ where: { matchId, userId: { not: null } }, select: { userId: true } })).map((p) => p.userId!);
  if (userIds.length < 2) return;
  const teams = await prisma.team.findMany({
    where: { memberships: { some: { userId: { in: userIds } } } },
    select: { id: true, memberships: { select: { userId: true } } },
  });
  for (const t of teams) {
    const present = t.memberships.filter((m) => userIds.includes(m.userId)).length;
    if (present >= 2) await computeTeamReport(t.id, matchId);
  }
}

/** Matchs communs d'un groupe (≥ 2 membres présents) ; calcule les rapports manquants. */
export async function syncTeamReports(teamId: string) {
  const memberIds = (await prisma.teamMembership.findMany({ where: { teamId }, select: { userId: true } })).map((m) => m.userId);
  const grouped = await prisma.matchParticipant.groupBy({
    by: ["matchId"],
    where: { userId: { in: memberIds }, match: { isDemo: false } },
    _count: { _all: true },
  });
  const common = grouped.filter((g) => g._count._all >= 2).map((g) => g.matchId);
  const existing = await prisma.teamMatchReport.findMany({ where: { teamId, scoreVersionId: CURRENT_SCORE_CONFIG.version }, select: { matchId: true, presentUserIds: true } });
  for (const matchId of common) {
    const ex = existing.find((e) => e.matchId === matchId);
    if (!ex) await computeTeamReport(teamId, matchId);
  }
  // rapports devenus obsolètes (membre parti → moins de 2 présents)
  for (const ex of existing) {
    const stillPresent = ex.presentUserIds.filter((u) => memberIds.includes(u));
    if (!common.includes(ex.matchId) || stillPresent.length !== ex.presentUserIds.length) await computeTeamReport(teamId, ex.matchId);
  }
  return common;
}
