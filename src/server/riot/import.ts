// Import de matchs via l'API Riot pour l'identité déclarée de l'utilisateur.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { badRequest } from "../errors";
import { afterMatchSaved } from "../matches/service";
import { convertRiotMatch, riotClient, type RiotClient } from "./client";

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
    await afterMatchSaved(created.id);
    results.push({ riotMatchId, status: "imported" });
  }
  return results;
}
