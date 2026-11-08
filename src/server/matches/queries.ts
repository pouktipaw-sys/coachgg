import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { CURRENT_SCORE_CONFIG } from "@/lib/scoring/config";

/** Matchs auxquels l'utilisateur a participé ou qu'il a créés (pour les sélecteurs). */
export async function userMatchOptions(userId: string) {
  const matches = await prisma.match.findMany({
    where: { OR: [{ createdById: userId }, { participants: { some: { userId } } }] },
    orderBy: [{ gameStartAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: { participants: { where: { userId }, select: { championName: true, win: true } } },
  });
  return matches.map((m) => {
    const me = m.participants[0];
    const date = (m.gameStartAt ?? m.createdAt).toLocaleDateString("fr-FR");
    return {
      id: m.id,
      label: `${date} · ${me?.championName ?? "?"} · ${me ? (me.win ? "Victoire" : "Défaite") : ""} · ${Math.round(m.durationSec / 60)} min`,
    };
  });
}

export const matchFiltersSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).default("all"),
  champion: z.string().trim().max(40).optional(),
  role: z.enum(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]).optional(),
  mode: z.string().max(20).optional(),
  with: z.enum(["solo", "friends"]).optional(),
  team: z.string().optional(),
});
export type MatchFilters = z.infer<typeof matchFiltersSchema>;

export function parseMatchFilters(raw: Record<string, string | undefined>): MatchFilters {
  const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ""));
  const r = matchFiltersSchema.safeParse(clean);
  return r.success ? r.data : matchFiltersSchema.parse({});
}

/** Historique de l'utilisateur, avec sa ligne de participant, sa note et le nombre d'amis présents. */
export async function listUserMatches(userId: string, f: MatchFilters, take = 100) {
  const days = { "7d": 7, "30d": 30, "90d": 90, all: null }[f.period];
  const since = days ? new Date(Date.now() - days * 86400_000) : null;
  const mine: Prisma.MatchParticipantWhereInput = {
    userId,
    ...(f.champion ? { championName: { equals: f.champion, mode: "insensitive" } } : {}),
    ...(f.role ? { role: f.role } : {}),
  };
  const friendIds = (
    await prisma.teamMembership.findMany({
      where: { team: { memberships: { some: { userId } } }, userId: { not: userId }, ...(f.team ? { teamId: f.team } : {}) },
      select: { userId: true },
    })
  ).map((m) => m.userId);

  const where: Prisma.MatchWhereInput = {
    participants: { some: mine },
    ...(f.mode ? { gameMode: f.mode } : {}),
    ...(since ? { OR: [{ gameStartAt: { gte: since } }, { gameStartAt: null, createdAt: { gte: since } }] } : {}),
    ...(f.with === "friends" || f.team ? { AND: [{ participants: { some: { userId: { in: friendIds } } } }] } : {}),
    ...(f.with === "solo" ? { NOT: { participants: { some: { userId: { in: friendIds } } } } } : {}),
  };
  const matches = await prisma.match.findMany({
    where,
    orderBy: [{ gameStartAt: "desc" }, { createdAt: "desc" }],
    take,
    include: {
      participants: {
        where: { OR: [{ userId }, { userId: { in: friendIds } }] },
        include: { statistics: true, scores: { where: { scoreVersionId: CURRENT_SCORE_CONFIG.version } }, user: { select: { displayName: true } } },
      },
      _count: { select: { recordings: true } },
    },
  });
  return matches.map((m) => {
    const me = m.participants.find((p) => p.userId === userId)!;
    return {
      id: m.id,
      source: m.source,
      isDemo: m.isDemo,
      gameMode: m.gameMode,
      date: m.gameStartAt ?? m.createdAt,
      durationSec: m.durationSec,
      me: {
        championName: me.championName,
        role: me.role,
        win: me.win,
        kills: me.statistics?.kills ?? null,
        deaths: me.statistics?.deaths ?? null,
        assists: me.statistics?.assists ?? null,
        creepScore: me.statistics?.creepScore ?? null,
        visionScore: me.statistics?.visionScore ?? null,
        score: me.scores[0]?.overall ?? null,
        reliability: me.scores[0]?.reliability ?? null,
      },
      friends: m.participants.filter((p) => p.userId !== userId).map((p) => p.user?.displayName ?? "?"),
      recordings: m._count.recordings,
    };
  });
}

export type MatchRow = Awaited<ReturnType<typeof listUserMatches>>[number];
