// Coéquipiers suivis : ajoutés par Riot ID (sans compte CoachGG nécessaire).
// Statistiques calculées sur les parties communes, dans la même équipe.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { HttpError, notFound } from "./errors";
import { PLATFORMS, riotClient } from "./riot/client";
import { env } from "@/lib/env";
import { tallyVotes } from "@/lib/votes";

export const teammateSchema = z.object({
  riotId: z
    .string()
    .trim()
    .regex(/^[^#]{3,16}#[\p{L}\p{N}]{2,5}$/u, "Format attendu : NomDeJeu#TAG"),
  platform: z.enum(PLATFORMS).default("EUW1"),
  nickname: z.string().trim().max(30).nullish(),
});

const MAX_TEAMMATES = 50;

export async function addTeammate(userId: string, raw: unknown) {
  const input = teammateSchema.parse(raw);
  const [gameName, tagLine] = input.riotId.split("#") as [string, string];
  const own = await prisma.gameIdentity.findFirst({
    where: { userId, gameName: { equals: gameName, mode: "insensitive" }, tagLine: { equals: tagLine, mode: "insensitive" } },
  });
  if (own) throw new HttpError(400, "self", "C'est votre propre Riot ID.");
  const exists = await prisma.teammate.findFirst({
    where: { ownerId: userId, gameName: { equals: gameName, mode: "insensitive" }, tagLine: { equals: tagLine, mode: "insensitive" } },
  });
  if (exists) throw new HttpError(409, "exists", "Ce coéquipier est déjà dans votre liste.");
  if ((await prisma.teammate.count({ where: { ownerId: userId } })) >= MAX_TEAMMATES)
    throw new HttpError(429, "too_many", `Limite de ${MAX_TEAMMATES} coéquipiers atteinte.`);
  // PUUID : connu si le joueur a un compte CoachGG lié, sinon résolu via Riot si la clé est configurée.
  let puuid =
    (await prisma.gameIdentity.findFirst({
      where: { gameName: { equals: gameName, mode: "insensitive" }, tagLine: { equals: tagLine, mode: "insensitive" }, puuid: { not: null } },
      select: { puuid: true },
    }))?.puuid ?? null;
  if (!puuid && env.riotApiKey) puuid = await riotClient().accountByRiotId(gameName, tagLine, input.platform).then((a) => a.puuid).catch(() => null);
  return prisma.teammate.create({ data: { ownerId: userId, gameName, tagLine, platform: input.platform, puuid, nickname: input.nickname ?? null } });
}

export async function removeTeammate(userId: string, id: string) {
  const t = await prisma.teammate.findFirst({ where: { id, ownerId: userId } });
  if (!t) throw notFound("Coéquipier");
  await prisma.teammate.delete({ where: { id } });
}

type Mate = { id: string; gameName: string; tagLine: string; puuid: string | null };

const mateWhere = (t: Mate): Prisma.MatchParticipantWhereInput => ({
  OR: [
    ...(t.puuid ? [{ puuid: t.puuid }] : []),
    { riotGameName: { equals: t.gameName, mode: "insensitive" as const }, riotTagLine: { equals: t.tagLine, mode: "insensitive" as const } },
  ],
});

/** Participations communes (même équipe) avec chaque coéquipier. */
async function gamesTogether(userId: string, mates: Mate[]) {
  const mine = await prisma.matchParticipant.findMany({ where: { userId }, select: { matchId: true, teamSide: true, win: true } });
  const byMatch = new Map(mine.map((m) => [m.matchId, m]));
  const result = new Map<string, { participantId: string; matchId: string; win: boolean }[]>();
  if (!mates.length || !mine.length) return result;
  const rows = await prisma.matchParticipant.findMany({
    // « userId: { not } » exclurait aussi les joueurs sans compte (NULL en SQL) : condition explicite.
    where: { matchId: { in: [...byMatch.keys()] }, AND: [{ OR: [{ userId: null }, { userId: { not: userId } }] }, { OR: mates.map(mateWhere) }] },
    select: { id: true, matchId: true, teamSide: true, puuid: true, riotGameName: true, riotTagLine: true },
  });
  for (const t of mates) {
    const list = rows
      .filter((r) => (t.puuid && r.puuid === t.puuid) || (r.riotGameName?.toLowerCase() === t.gameName.toLowerCase() && r.riotTagLine?.toLowerCase() === t.tagLine.toLowerCase()))
      .filter((r) => byMatch.get(r.matchId)?.teamSide === r.teamSide)
      .map((r) => ({ participantId: r.id, matchId: r.matchId, win: byMatch.get(r.matchId)!.win }));
    result.set(t.id, list);
  }
  return result;
}

export async function listTeammates(userId: string) {
  const mates = await prisma.teammate.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "asc" } });
  const together = await gamesTogether(userId, mates);
  const participantIds = [...together.values()].flat().map((g) => g.participantId);
  const votes = participantIds.length ? await prisma.peerVote.findMany({ where: { targetId: { in: participantIds } } }) : [];
  return mates.map((t) => {
    const games = together.get(t.id) ?? [];
    const ids = new Set(games.map((g) => g.participantId));
    const received = votes.filter((v) => ids.has(v.targetId));
    const all = tallyVotes(received);
    const mine = received.filter((v) => v.voterId === userId);
    const sum = (xs: { score: number }[]) => (xs.length ? Math.round((xs.reduce((a, v) => a + v.score, 0) / xs.length) * 10) / 10 : null);
    const awards: Record<string, number> = {};
    for (const v of received) for (const a of v.awards) awards[a] = (awards[a] ?? 0) + 1;
    return {
      id: t.id,
      riotId: `${t.gameName}#${t.tagLine}`,
      nickname: t.nickname,
      platform: t.platform,
      resolved: !!t.puuid,
      games: games.length,
      wins: games.filter((g) => g.win).length,
      myAvgScore: sum(mine),
      avgScore: sum(received),
      mvpVotes: received.filter((v) => v.mvp).length,
      awards,
      voters: all.voters,
    };
  });
}

/** Identifiants des parties jouées avec ce coéquipier (même équipe) — filtre de l'historique. */
export async function matchIdsWithTeammate(userId: string, teammateId: string) {
  const t = await prisma.teammate.findFirst({ where: { id: teammateId, ownerId: userId } });
  if (!t) return [];
  return ((await gamesTogether(userId, [t])).get(t.id) ?? []).map((g) => g.matchId);
}
