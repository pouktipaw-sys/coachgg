// Appareils (application PC) : appairage par code à usage unique, jeton
// d'appareil révocable, état de capture, événements de partie.
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { HttpError, badRequest, notFound } from "./errors";
import { newToken, sha256 } from "./auth/session";
import { requireRecordingOwner } from "./permissions";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/1/I
const CODE_TTL_MS = 10 * 60_000;
const MAX_DEVICES = 5;

export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function createPairingCode(userId: string) {
  const active = await prisma.devicePairingCode.count({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } } });
  if (active >= 5) throw new HttpError(429, "too_many_codes", "Trop de codes actifs : utilisez-en un ou attendez leur expiration.");
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await prisma.devicePairingCode.create({ data: { id: sha256(raw), userId, expiresAt } });
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
}

export const pairSchema = z.object({
  code: z.string().min(8).max(12),
  name: z.string().trim().min(1).max(60),
  platform: z.enum(["windows", "linux", "macos"]),
  appVersion: z.string().trim().max(20),
});

/** Échange un code valide contre un jeton d'appareil (renvoyé une seule fois). */
export async function pairDevice(raw: unknown) {
  const input = pairSchema.parse(raw);
  const id = sha256(normalizeCode(input.code));
  const now = new Date();
  // Consommation atomique : un code ne sert qu'une fois.
  const code = await prisma.devicePairingCode.findUnique({ where: { id } });
  const used = await prisma.devicePairingCode.updateMany({ where: { id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (!code || used.count !== 1) throw new HttpError(400, "invalid_code", "Code d'appairage invalide ou expiré.");
  const count = await prisma.device.count({ where: { userId: code.userId, revokedAt: null } });
  if (count >= MAX_DEVICES) throw new HttpError(429, "too_many_devices", `Limite de ${MAX_DEVICES} appareils : révoquez-en un.`);
  const token = `cgd_${newToken()}`;
  const device = await prisma.device.create({
    data: { userId: code.userId, name: input.name, platform: input.platform, appVersion: input.appVersion, tokenHash: sha256(token) },
  });
  return { token, device: { id: device.id, name: device.name } };
}

export type DeviceContext = { id: string; userId: string; name: string };

/** Authentifie un appareil via « Authorization: Bearer cgd_… ». */
export async function deviceFromAuthHeader(header: string | null): Promise<DeviceContext | null> {
  const m = header?.match(/^Bearer (cgd_[\w-]{20,})$/);
  if (!m) return null;
  const d = await prisma.device.findUnique({ where: { tokenHash: sha256(m[1]!) } });
  if (!d || d.revokedAt) return null;
  if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > 60_000) {
    await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return { id: d.id, userId: d.userId, name: d.name };
}

export async function listDevices(userId: string) {
  return prisma.device.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, platform: true, appVersion: true, createdAt: true, lastSeenAt: true, revokedAt: true, status: true },
  });
}

export async function revokeDevice(userId: string, deviceId: string) {
  const r = await prisma.device.updateMany({ where: { id: deviceId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw notFound("Appareil");
}

export const statusSchema = z.object({
  state: z.enum(["idle", "waiting_game", "recording", "processing", "uploading", "error"]),
  message: z.string().max(300).optional(),
  queue: z.number().int().min(0).max(10_000).default(0),
  diskUsedBytes: z.number().int().min(0).default(0),
  diskLimitBytes: z.number().int().min(0).default(0),
  captureBackend: z.string().max(40).optional(),
  appVersion: z.string().max(20).optional(),
});

export async function deviceHeartbeat(device: DeviceContext, raw: unknown) {
  const status = statusSchema.parse(raw);
  await prisma.device.update({
    where: { id: device.id },
    data: { status: { ...status, at: new Date().toISOString() } as Prisma.InputJsonValue, lastSeenAt: new Date(), ...(status.appVersion ? { appVersion: status.appVersion } : {}) },
  });
  return { ok: true };
}

// ─────────────── Événements de partie (API locale du client, après match) ───────────────
// L'agent enregistre les événements pendant la partie SANS rien afficher ni
// conseiller ; ils ne sont envoyés et exploités qu'après le match.

export const liveEventsSchema = z.object({
  activePlayer: z.string().trim().max(60),
  events: z
    .array(
      z.object({
        name: z.string().max(40),
        gameTimeMs: z.number().int().min(0).max(6 * 3600_000),
        killer: z.string().max(60).nullish(),
        victim: z.string().max(60).nullish(),
        assisters: z.array(z.string().max(60)).max(10).optional(),
      }),
    )
    .max(2000),
});

/** Compare des noms de joueur « Nom#TAG » ou « Nom » (le format varie selon les versions du client). */
export function samePlayer(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const base = (s: string) => s.split("#")[0]!.trim().toLowerCase();
  return a.trim().toLowerCase() === b.trim().toLowerCase() || base(a) === base(b);
}

/** Enregistre les morts du joueur comme vérité terrain (source LIVE_CLIENT), en temps vidéo. */
export async function ingestLiveEvents(userId: string, recordingId: string, raw: unknown) {
  await requireRecordingOwner(userId, recordingId);
  const input = liveEventsSchema.parse(raw);
  const rec = await prisma.recording.findUniqueOrThrow({ where: { id: recordingId }, select: { gameStartOffsetMs: true, durationMs: true, sizeBytes: true } });
  if (rec.gameStartOffsetMs == null) throw badRequest("Vidéo non synchronisée avec l'horloge du jeu.");
  const deaths = input.events
    .filter((e) => e.name === "ChampionKill" && samePlayer(e.victim, input.activePlayer))
    .map((e) => e.gameTimeMs + rec.gameStartOffsetMs!)
    .filter((t) => t >= 0 && (rec.durationMs == null || t <= rec.durationMs));
  await prisma.$transaction([
    prisma.groundTruthEvent.deleteMany({ where: { recordingId, source: "LIVE_CLIENT" } }),
    prisma.groundTruthEvent.createMany({ data: deaths.map((videoMs) => ({ recordingId, videoMs, source: "LIVE_CLIENT" as const, createdById: userId })) }),
  ]);
  return { deaths: deaths.length };
}
