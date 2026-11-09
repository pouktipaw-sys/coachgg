// Bibliothèque de clips : séquences personnelles (favoris, notes, catégories),
// créées depuis le lecteur ou à partir d'un moment de coaching.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { badRequest, notFound } from "./errors";
import { requireRecordingView } from "./permissions";
import { visibleRecommendationWhere } from "./analysis/review";
import { storage } from "./storage";
import { enqueueJob, retryJob } from "./jobs";
import { MOMENT_KINDS } from "@/lib/annotations/schema";

const MAX_CLIP_MS = 3 * 60_000;

export const clipCreateSchema = z
  .object({
    recordingId: z.string(),
    title: z.string().trim().min(1).max(120),
    kind: z.enum(MOMENT_KINDS),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(1),
    personalNote: z.string().trim().max(2000).optional(),
  })
  .refine((c) => c.endMs > c.startMs && c.endMs - c.startMs <= MAX_CLIP_MS, { message: "Un clip dure entre 0 et 3 minutes.", path: ["endMs"] });

/** Clip personnel sur une vidéo que l'utilisateur peut voir (la sienne ou partagée). */
export async function createClip(userId: string, raw: unknown) {
  const input = clipCreateSchema.parse(raw);
  await requireRecordingView(userId, input.recordingId);
  const rec = await prisma.recording.findUniqueOrThrow({ where: { id: input.recordingId }, select: { durationMs: true } });
  if (rec.durationMs != null && input.endMs > rec.durationMs + 500) throw badRequest("Le clip dépasse la fin de la vidéo.");
  return prisma.clip.create({ data: { ...input, ownerId: userId, provenance: "MANUAL" } });
}

/** Clip couvrant la fenêtre d'un moment de coaching (contexte → fin). */
export async function clipFromMoment(userId: string, recommendationId: string) {
  const r = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!r) throw notFound("Moment");
  const access = await requireRecordingView(userId, r.recordingId);
  const visible = await prisma.recommendation.count({ where: { id: r.id, ...visibleRecommendationWhere(access === "owner") } });
  if (!visible) throw notFound("Moment");
  const existing = await prisma.clip.findFirst({ where: { ownerId: userId, recordingId: r.recordingId, startMs: r.contextStartMs, endMs: r.endMs } });
  if (existing) return existing;
  return prisma.clip.create({
    data: { ownerId: userId, recordingId: r.recordingId, title: r.title, kind: r.kind, startMs: r.contextStartMs, endMs: r.endMs, provenance: r.provenance },
  });
}

export const clipFiltersSchema = z.object({
  q: z.string().trim().max(80).optional(),
  kind: z.enum(MOMENT_KINDS).optional(),
  favorite: z.enum(["1"]).optional(),
  recordingId: z.string().optional(),
});

export async function listClips(userId: string, raw: Record<string, string | undefined>) {
  const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v));
  const f = clipFiltersSchema.safeParse(clean).data ?? {};
  const where: Prisma.ClipWhereInput = {
    ownerId: userId,
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.favorite ? { favorite: true } : {}),
    ...(f.recordingId ? { recordingId: f.recordingId } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { personalNote: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  // Un clip dont la vidéo n'est plus accessible (partage retiré) n'est plus listé.
  const clips = await prisma.clip.findMany({
    where,
    orderBy: [{ favorite: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { recording: { select: { id: true, title: true, ownerId: true, thumbnailKey: true, owner: { select: { displayName: true } } } } },
  });
  const out = [];
  for (const c of clips) {
    if (c.recording.ownerId === userId) out.push(c);
    else {
      try {
        await requireRecordingView(userId, c.recordingId);
        out.push(c);
      } catch {
        /* accès retiré */
      }
    }
  }
  return out;
}

async function ownClip(userId: string, id: string) {
  const c = await prisma.clip.findUnique({ where: { id } });
  if (!c || c.ownerId !== userId) throw notFound("Clip");
  return c;
}

export const clipUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(MOMENT_KINDS).optional(),
  favorite: z.boolean().optional(),
  personalNote: z.string().trim().max(2000).nullable().optional(),
});

export async function updateClip(userId: string, id: string, raw: unknown) {
  await ownClip(userId, id);
  return prisma.clip.update({ where: { id }, data: clipUpdateSchema.parse(raw) });
}

export async function deleteClip(userId: string, id: string) {
  const c = await ownClip(userId, id);
  if (c.exportKey) await storage().delete(c.exportKey);
  await prisma.clip.delete({ where: { id } });
}

/** Demande l'export vidéo annoté (rendu par le worker). */
export async function requestClipExport(userId: string, id: string) {
  const c = await ownClip(userId, id);
  await requireRecordingView(userId, c.recordingId); // l'accès à la vidéo doit toujours exister
  const job = await enqueueJob({ type: "EXPORT_CLIP", idempotencyKey: `export:${c.id}`, recordingId: c.recordingId, payload: { clipId: c.id }, maxAttempts: 2 });
  if (job.status !== "PENDING" && job.status !== "RUNNING") await retryJob(job.id);
  return prisma.clip.update({ where: { id }, data: { exportStatus: "PENDING", exportError: null } });
}

export async function clipExportFile(userId: string, id: string) {
  const c = await ownClip(userId, id);
  await requireRecordingView(userId, c.recordingId);
  if (c.exportStatus !== "READY" || !c.exportKey) throw notFound("Export");
  return c;
}
