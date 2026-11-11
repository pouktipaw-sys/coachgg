import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { env } from "@/lib/env";
import { requestRiotSync, syncStatuses } from "@/server/riot/import";

/** État de la synchronisation de chaque compte Riot de l'utilisateur. */
export const GET = authed(async (_req, user) => json({ configured: !!env.riotApiKey, accounts: await syncStatuses(user.id) }));

/** Relance une synchronisation complète (d'un compte, ou de tous). */
export const POST = authed(async (req, user) => {
  if (!env.riotApiKey) throw new HttpError(503, "riot_not_configured", "Intégration Riot non configurée (RIOT_API_KEY absente).");
  if (!rateLimit(`riot-sync:${user.id}`, 12, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de synchronisations récentes.");
  const { identityId } = z.object({ identityId: z.string().optional() }).parse((await readJson(req).catch(() => ({}))) ?? {});
  const ids = identityId ? [identityId] : (await prisma.gameIdentity.findMany({ where: { userId: user.id, provider: "riot" }, select: { id: true } })).map((i) => i.id);
  if (!ids.length) throw new HttpError(400, "no_identity", "Ajoutez d'abord votre Riot ID dans les paramètres.");
  for (const id of ids) await requestRiotSync(user.id, "full", id);
  return json({ ok: true, accounts: ids.length }, 202);
});
