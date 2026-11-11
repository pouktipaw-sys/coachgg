import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/errors";
import { PLATFORMS } from "@/server/riot/client";
import { requestRiotSync } from "@/server/riot/import";
import { env } from "@/lib/env";

// Riot ID : « NomDeJeu#TAG ». Aucun mot de passe Riot n'est jamais demandé.
const schema = z.object({
  gameName: z.string().trim().min(3).max(16),
  tagLine: z.string().trim().min(2).max(5).regex(/^[\p{L}\p{N}]+$/u, "Tag invalide"),
  platform: z.enum(PLATFORMS),
});

export const GET = authed(async (_req, user) => json({ identities: await prisma.gameIdentity.findMany({ where: { userId: user.id } }) }));

export const POST = authed(async (req, user) => {
  const input = schema.parse(await readJson(req));
  const exists = await prisma.gameIdentity.findFirst({
    where: { userId: user.id, gameName: { equals: input.gameName, mode: "insensitive" }, tagLine: { equals: input.tagLine, mode: "insensitive" } },
  });
  if (exists) throw new HttpError(409, "exists", "Cette identité est déjà associée.");
  await prisma.gameIdentity.updateMany({ where: { userId: user.id }, data: { isPrimary: false } });
  const identity = await prisma.gameIdentity.create({ data: { userId: user.id, ...input, verification: "DECLARED", isPrimary: true } });
  // Clé Riot configurée : tout l'historique est importé en tâche de fond.
  const historySync = env.riotApiKey ? await requestRiotSync(user.id, "full").then(() => true).catch(() => false) : false;
  return json({ identity, historySync }, 201);
});
