// Envoi de vidéo par morceaux, reprenable après interruption.
//
// Protocole :
//  1. POST /api/recordings           → crée l'enregistrement (UPLOADING), renvoie chunkSize
//  2. PUT  /api/recordings/:id/upload  en-tête Upload-Offset = octets déjà reçus
//  3. GET  /api/recordings/:id/upload  → { receivedBytes } pour reprendre
//  Quand tous les octets sont reçus → UPLOADED + tâche PROCESS_RECORDING (idempotente).
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, badRequest, notFound } from "../errors";
import { storage, recordingPrefix } from "../storage";
import { env } from "@/lib/env";
import { enqueueJob } from "../jobs";
import { expectedContainer, extensionOf, mimeAcceptable, sniffContainer } from "./formats";

export const createUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().max(100).default(""),
  title: z.string().trim().max(120).optional(),
  matchId: z.string().optional(),
});

const MAX_ACTIVE_UPLOADS = 3;
const MAX_UPLOADS_PER_DAY = 30;

export async function createUpload(userId: string, raw: unknown) {
  const input = createUploadSchema.parse(raw);
  const ext = extensionOf(input.filename);
  if (!ext) throw badRequest("Format non pris en charge. Formats acceptés : MP4, MOV, M4V, WEBM, MKV.");
  if (!mimeAcceptable(input.mimeType)) throw badRequest(`Type de fichier refusé (${input.mimeType}).`);
  if (input.sizeBytes > env.maxUploadBytes)
    throw badRequest(`Fichier trop volumineux (max ${(env.maxUploadBytes / 1024 ** 3).toFixed(1)} Go).`);
  if (input.sizeBytes < 1024) throw badRequest("Fichier trop petit pour être une vidéo.");

  if (input.matchId) {
    const ok = await prisma.matchParticipant.count({ where: { matchId: input.matchId, userId } });
    const created = await prisma.match.count({ where: { id: input.matchId, createdById: userId } });
    if (!ok && !created) throw notFound("Match");
  }

  // Quotas : uploads simultanés, uploads par jour, espace total.
  const [active, today, used] = await Promise.all([
    prisma.recording.count({ where: { ownerId: userId, status: "UPLOADING" } }),
    prisma.recording.count({ where: { ownerId: userId, createdAt: { gte: new Date(Date.now() - 86400_000) } } }),
    prisma.recording.aggregate({ where: { ownerId: userId }, _sum: { sizeBytes: true } }),
  ]);
  if (active >= MAX_ACTIVE_UPLOADS)
    throw new HttpError(429, "too_many_uploads", "Trop d'envois en cours. Terminez ou annulez un envoi.");
  if (today >= MAX_UPLOADS_PER_DAY) throw new HttpError(429, "daily_quota", "Quota journalier d'envois atteint.");
  const usedBytes = Number(used._sum.sizeBytes ?? 0);
  if (usedBytes + input.sizeBytes > env.userQuotaBytes)
    throw new HttpError(413, "storage_quota", "Espace de stockage insuffisant. Supprimez d'anciennes vidéos.");

  const rec = await prisma.recording.create({
    data: {
      ownerId: userId,
      matchId: input.matchId,
      title: input.title || input.filename.replace(/\.[^.]+$/, "").slice(0, 120),
      originalFilename: input.filename,
      declaredMime: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      originalKey: "pending",
    },
  });
  const originalKey = `${recordingPrefix(userId, rec.id)}original.${ext}`;
  await prisma.recording.update({ where: { id: rec.id }, data: { originalKey } });
  await storage().truncate(originalKey, 0);
  return { id: rec.id, chunkSize: env.chunkBytes, receivedBytes: 0 };
}

// Verrou en mémoire par enregistrement : sérialise les écritures concurrentes
// (instance unique ; la condition SQL sur receivedBytes protège en plus).
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  const chain = prev.then(() => p);
  locks.set(key, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chain) locks.delete(key);
  }
}

export async function appendChunk(userId: string, recordingId: string, offset: number, data: Uint8Array) {
  return withLock(recordingId, async () => {
    const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
    if (!rec || rec.ownerId !== userId) throw notFound("Vidéo");
    if (rec.status !== "UPLOADING") throw new HttpError(409, "not_uploading", "Cet envoi est déjà terminé.");
    const received = Number(rec.receivedBytes);
    const total = Number(rec.sizeBytes);
    if (offset !== received)
      throw new HttpError(409, "offset_mismatch", "Décalage incorrect : reprenez à la position indiquée.", { receivedBytes: received });
    if (data.byteLength === 0) throw badRequest("Morceau vide.");
    if (data.byteLength > env.chunkBytes) throw badRequest("Morceau trop volumineux.");
    if (received + data.byteLength > total) throw badRequest("Le fichier dépasse la taille annoncée.");

    if (offset === 0) {
      const ext = extensionOf(rec.originalFilename)!;
      const kind = sniffContainer(data.subarray(0, 16));
      if (kind !== expectedContainer(ext)) {
        await failUpload(rec.id, "Le contenu du fichier ne correspond pas à une vidéo valide de ce format.");
        throw badRequest("Le contenu du fichier ne correspond pas à une vidéo valide de ce format.");
      }
    }

    const st = storage();
    // Réaligne le fichier si une écriture précédente a été interrompue après l'append.
    const onDisk = await st.size(rec.originalKey);
    if (onDisk !== received) await st.truncate(rec.originalKey, received);
    await st.append(rec.originalKey, data);

    const newReceived = received + data.byteLength;
    const done = newReceived === total;
    const updated = await prisma.recording.updateMany({
      where: { id: rec.id, receivedBytes: BigInt(received), status: "UPLOADING" },
      data: { receivedBytes: BigInt(newReceived), ...(done ? { status: "UPLOADED" } : {}) },
    });
    if (updated.count !== 1) throw new HttpError(409, "conflict", "Envoi concurrent détecté. Réessayez.");
    if (done) {
      await enqueueJob({ type: "PROCESS_RECORDING", idempotencyKey: `process:${rec.id}`, recordingId: rec.id });
    }
    return { receivedBytes: newReceived, complete: done };
  });
}

async function failUpload(recordingId: string, message: string) {
  await prisma.recording.update({ where: { id: recordingId }, data: { status: "FAILED", errorMessage: message } });
}

export async function uploadState(userId: string, recordingId: string) {
  const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!rec || rec.ownerId !== userId) throw notFound("Vidéo");
  return { status: rec.status, receivedBytes: Number(rec.receivedBytes), sizeBytes: Number(rec.sizeBytes), chunkSize: env.chunkBytes };
}

/** Suppression complète : fichiers + base (annotations, moments, partages en cascade). */
export async function deleteRecording(userId: string, recordingId: string) {
  const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!rec || rec.ownerId !== userId) throw notFound("Vidéo");
  // Demande l'annulation d'un traitement en cours avant de retirer les fichiers.
  await prisma.analysisJob.updateMany({
    where: { recordingId, status: { in: ["PENDING", "RUNNING"] } },
    data: { cancelRequested: true },
  });
  await storage().deletePrefix(recordingPrefix(rec.ownerId, rec.id));
  await prisma.recording.delete({ where: { id: rec.id } });
}
