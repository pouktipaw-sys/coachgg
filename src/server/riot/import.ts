// Import de matchs via l'API Riot pour l'identité déclarée de l'utilisateur.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { badRequest } from "../errors";
import { afterMatchSaved } from "../matches/service";
import { RANKED_QUEUES, convertRiotMatch, participantTimeline, riotClient, type RiotClient } from "./client";
import { notFound } from "../errors";

export async function importRecentMatches(userId: string, count = 5, client: RiotClient = riotClient()) {
  const identity = await prisma.gameIdentity.findFirst({ where: { userId, provider: "riot", isPrimary: true } });
  if (!identity) throw badRequest("Ajoutez d'abord votre Riot ID dans les paramètres.");
  let puuid = identity.puuid;
  if (!puuid) {
    const acc = await client.accountByRiotId(identity.gameName, identity.tagLine, identity.platform);
    puuid = acc.puuid;
    await prisma.gameIdentity.update({ where: { id: identity.id }, data: { puuid } });
  }
  const ids = await client.matchIds(puuid, identity.platform, count);
  const results: { riotMatchId: string; status: "imported" | "already" | "linked" }[] = [];
  for (const riotMatchId of ids) {
    const existing = await prisma.match.findUnique({ where: { riotMatchId }, include: { participants: true } });
    if (existing) {
      // Match déjà importé (par un ami) : on lie simplement le participant à ce compte.
      const mine = existing.participants.find((p) => p.puuid === puuid);
      if (mine && !mine.userId) {
        await prisma.matchParticipant.update({ where: { id: mine.id }, data: { userId } });
        await afterMatchSaved(existing.id);
        results.push({ riotMatchId, status: "linked" });
      } else results.push({ riotMatchId, status: "already" });
      continue;
    }
    const m = convertRiotMatch(await client.match(riotMatchId));
    // Comptes CoachGG liés par PUUID (renseigné uniquement après résolution Riot).
    const puuids = m.participants.map((p) => p.puuid);
    const known = await prisma.gameIdentity.findMany({ where: { puuid: { in: puuids } }, select: { puuid: true, userId: true } });
    const created = await prisma.match.create({
      data: {
        source: "RIOT_API",
        riotMatchId: m.riotMatchId,
        platform: m.platform,
        queueId: m.queueId,
        gameMode: m.gameMode,
        gameStartAt: m.gameStartAt,
        durationSec: m.durationSec,
        gameVersion: m.gameVersion,
        createdById: userId,
        teamStats: m.teamStats as Prisma.InputJsonValue,
        participants: {
          create: m.participants.map((p) => ({
            puuid: p.puuid,
            userId: p.puuid === puuid ? userId : known.find((k) => k.puuid === p.puuid)?.userId ?? null,
            riotGameName: p.riotGameName,
            riotTagLine: p.riotTagLine,
            championName: p.championName,
            role: p.role,
            teamSide: p.teamSide,
            win: p.win,
            statistics: { create: p.stats },
          })),
        },
      },
    });
    // Évolution minute par minute (or, CS, achats) : facultative, l'import reste valide sans elle.
    try {
      const tl = await client.timeline(m.riotMatchId);
      const parts = await prisma.matchParticipant.findMany({ where: { matchId: created.id }, select: { id: true, puuid: true } });
      for (const p of parts) {
        const series = p.puuid ? participantTimeline(tl, p.puuid) : null;
        if (series) await prisma.matchStatistics.updateMany({ where: { participantId: p.id }, data: { timeline: series } });
      }
    } catch {
      /* timeline indisponible */
    }
    await afterMatchSaved(created.id);
    results.push({ riotMatchId, status: "imported" });
  }
  return results;
}

/** Met à jour le rang (LEAGUE-V4) de l'identité Riot de l'utilisateur. */
export async function refreshRank(userId: string, identityId: string, client: RiotClient = riotClient()) {
  const identity = await prisma.gameIdentity.findFirst({ where: { id: identityId, userId } });
  if (!identity) throw notFound("Identité");
  let puuid = identity.puuid;
  if (!puuid) {
    puuid = (await client.accountByRiotId(identity.gameName, identity.tagLine, identity.platform)).puuid;
  }
  const entries = await client.leagueEntries(puuid, identity.platform);
  const rank = entries
    .filter((e) => RANKED_QUEUES[e.queueType])
    .map((e) => ({ queue: e.queueType, label: RANKED_QUEUES[e.queueType], tier: e.tier, division: e.rank, lp: e.leaguePoints, wins: e.wins, losses: e.losses }));
  return prisma.gameIdentity.update({ where: { id: identity.id }, data: { puuid, rank, rankFetchedAt: new Date() } });
}
