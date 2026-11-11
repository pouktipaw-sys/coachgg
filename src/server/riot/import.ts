// Import de matchs via l'API Riot pour l'identité déclarée de l'utilisateur.
// • Import ponctuel (bouton) : quelques parties récentes.
// • Synchronisation de l'historique (tâche de fond RIOT_SYNC) : complète à l'ajout du Riot ID,
//   puis incrémentale (s'arrête à la première partie déjà connue).
import type { AnalysisJob, GameIdentity, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, notFound } from "../errors";
import { PermanentJobError, enqueueJob, retryJob, setJobProgress } from "../jobs";
import { notify } from "../notifications";
import { afterMatchSaved } from "../matches/service";
import { env } from "@/lib/env";
import { RANKED_QUEUES, RiotApiError, RiotNotConfiguredError, convertRiotMatch, participantTimeline, riotClient, type RiotClient } from "./client";

export type ImportStatus = "imported" | "already" | "linked";

async function primaryIdentity(userId: string) {
  const identity = await prisma.gameIdentity.findFirst({ where: { userId, provider: "riot", isPrimary: true } });
  if (!identity) throw badRequest("Ajoutez d'abord votre Riot ID dans les paramètres.");
  return identity;
}

async function ensurePuuid(identity: GameIdentity, client: RiotClient) {
  if (identity.puuid) return identity.puuid;
  const acc = await client.accountByRiotId(identity.gameName, identity.tagLine, identity.platform);
  await prisma.gameIdentity.update({ where: { id: identity.id }, data: { puuid: acc.puuid } });
  return acc.puuid;
}

/** Importe (ou lie) une partie. `withTimeline` : évolution minute par minute (un appel de plus). */
async function importOne(userId: string, puuid: string, riotMatchId: string, client: RiotClient, withTimeline = true): Promise<ImportStatus> {
  const existing = await prisma.match.findUnique({ where: { riotMatchId }, include: { participants: true } });
  if (existing) {
    // Match déjà importé (par un ami) : on lie simplement le participant à ce compte.
    const mine = existing.participants.find((p) => p.puuid === puuid);
    if (mine && !mine.userId) {
      await prisma.matchParticipant.update({ where: { id: mine.id }, data: { userId } });
      await afterMatchSaved(existing.id);
      return "linked";
    }
    return "already";
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
  if (withTimeline) {
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
  }
  await afterMatchSaved(created.id);
  return "imported";
}

export async function importRecentMatches(userId: string, count = 5, client: RiotClient = riotClient()) {
  const identity = await primaryIdentity(userId);
  const puuid = await ensurePuuid(identity, client);
  const ids = await client.matchIds(puuid, identity.platform, count);
  const results: { riotMatchId: string; status: ImportStatus }[] = [];
  for (const riotMatchId of ids) results.push({ riotMatchId, status: await importOne(userId, puuid, riotMatchId, client) });
  return results;
}

// ───────────── Synchronisation de l'historique (tâche de fond) ─────────────

export type SyncMode = "full" | "incremental";
const PAGE = 100;
const TIMELINE_RECENT = 20; // timeline uniquement pour les parties les plus récentes (quota Riot)
export const INCREMENTAL_EVERY_MS = 15 * 60_000;

/** Met en file la synchronisation de l'historique (une seule tâche par utilisateur). */
export async function requestRiotSync(userId: string, mode: SyncMode = "full") {
  const payload = { userId, mode };
  const job = await enqueueJob({ type: "RIOT_SYNC", idempotencyKey: `riot-sync:${userId}`, payload, maxAttempts: 3 });
  if (job.status === "RUNNING" || job.status === "PENDING") return job;
  await prisma.analysisJob.update({ where: { id: job.id }, data: { payload } });
  return retryJob(job.id);
}

/**
 * Appelé à l'ouverture du tableau de bord / de l'historique : première synchronisation complète,
 * puis mise à jour incrémentale au plus toutes les 15 minutes. Sans clé Riot : rien.
 */
export async function autoSyncIfDue(userId: string) {
  if (!env.riotApiKey) return null;
  const identity = await prisma.gameIdentity.findFirst({ where: { userId, provider: "riot", isPrimary: true } });
  if (!identity) return null;
  if (identity.historySyncedAt && Date.now() - identity.historySyncedAt.getTime() < INCREMENTAL_EVERY_MS) return null;
  const job = await prisma.analysisJob.findUnique({ where: { idempotencyKey: `riot-sync:${userId}` } });
  if (job && (job.status === "PENDING" || job.status === "RUNNING")) return job;
  // Pas de nouvelle tentative en boucle après un échec récent (clé expirée, etc.).
  if (job?.status === "FAILED" && job.finishedAt && Date.now() - job.finishedAt.getTime() < INCREMENTAL_EVERY_MS) return null;
  return requestRiotSync(userId, identity.historySyncedAt ? "incremental" : "full");
}

export async function runRiotSync(job: AnalysisJob, client?: RiotClient) {
  try {
    return await syncHistory(job, client);
  } catch (e) {
    // Clé absente/refusée, Riot ID introuvable : inutile de réessayer automatiquement.
    if (e instanceof RiotNotConfiguredError) throw new PermanentJobError(e.message);
    if (e instanceof RiotApiError && [400, 401, 403, 404].includes(e.status)) throw new PermanentJobError(e.message);
    throw e;
  }
}

async function syncHistory(job: AnalysisJob, client?: RiotClient) {
  const { userId, mode } = job.payload as { userId: string; mode: SyncMode };
  const max = env.riotHistoryMax;
  const identity = await primaryIdentity(userId);
  const c = client ?? riotClient(undefined, { maxRetries: 6, maxWaitSec: 120 });
  const puuid = await ensurePuuid(identity, c);
  const counts = { imported: 0, linked: 0, already: 0 };
  let seen = 0;
  outer: for (let start = 0; seen < max; start += PAGE) {
    const ids = await c.matchIds(puuid, identity.platform, Math.min(PAGE, max - seen), start);
    if (!ids.length) break;
    for (const id of ids) {
      if (seen >= max) break outer;
      const status = await importOne(userId, puuid, id, c, seen < TIMELINE_RECENT);
      counts[status]++;
      seen++;
      await setJobProgress(job.id, (seen / max) * 100);
      // Incrémental : l'historique est à jour dès qu'on retrouve une partie déjà importée pour ce compte.
      if (mode === "incremental" && status === "already") break outer;
    }
    if (ids.length < PAGE) break;
  }
  await prisma.gameIdentity.update({ where: { id: identity.id }, data: { historySyncedAt: new Date() } });
  await refreshRank(userId, identity.id, c).catch(() => null);
  const added = counts.imported + counts.linked;
  if (added > 0)
    await notify(userId, {
      type: "riot_sync",
      title: mode === "full" ? "Historique Riot importé" : "Nouvelles parties importées",
      body: `${added} partie(s) ajoutée(s) à votre historique.`,
      link: "/app/matches",
    });
  return { mode, ...counts, scanned: seen, max };
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
