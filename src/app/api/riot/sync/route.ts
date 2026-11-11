import { authed, json } from "@/server/http";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { env } from "@/lib/env";
import { requestRiotSync } from "@/server/riot/import";

/** État de la synchronisation de l'historique Riot de l'utilisateur. */
export const GET = authed(async (_req, user) => {
  const job = await prisma.analysisJob.findUnique({
    where: { idempotencyKey: `riot-sync:${user.id}` },
    select: { status: true, progress: true, error: true, result: true, finishedAt: true },
  });
  return json({ configured: !!env.riotApiKey, job });
});

/** Relance une synchronisation complète de l'historique. */
export const POST = authed(async (_req, user) => {
  if (!env.riotApiKey) throw new HttpError(503, "riot_not_configured", "Intégration Riot non configurée (RIOT_API_KEY absente).");
  if (!rateLimit(`riot-sync:${user.id}`, 6, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de synchronisations récentes.");
  const identity = await prisma.gameIdentity.findFirst({ where: { userId: user.id, provider: "riot", isPrimary: true } });
  if (!identity) throw new HttpError(400, "no_identity", "Ajoutez d'abord votre Riot ID dans les paramètres.");
  const job = await requestRiotSync(user.id, "full");
  return json({ job: { status: job.status } }, 202);
});
