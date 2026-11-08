// Moments de coaching (recommandations) et annotations : persistance + permissions.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, notFound } from "../errors";
import { requireRecordingOwner, requireRecordingView } from "../permissions";
import { visibleAnnotationWhere, visibleRecommendationWhere } from "../analysis/review";
import { annotationInputSchema, recommendationInputSchema, ANNOTATION_SCHEMA_VERSION } from "@/lib/annotations/schema";

const recInclude = {
  observations: { orderBy: { createdAt: "asc" } },
  annotations: { select: { id: true } },
} satisfies Prisma.RecommendationInclude;

function assertWithinDuration(durationMs: number | null, ...times: number[]) {
  if (durationMs == null) return;
  if (times.some((t) => t > durationMs + 500)) throw badRequest("Horodatage au-delà de la fin de la vidéo.");
}

export async function getCoachingData(userId: string, recordingId: string) {
  const access = await requireRecordingView(userId, recordingId);
  const recording = await prisma.recording.findUniqueOrThrow({
    where: { id: recordingId },
    include: {
      match: { select: { id: true, gameMode: true, durationSec: true, source: true, isDemo: true } },
      owner: { select: { id: true, displayName: true } },
    },
  });
  const [recommendations, annotations] = await Promise.all([
    prisma.recommendation.findMany({
      where: { recordingId, ...visibleRecommendationWhere(access === "owner") },
      include: recInclude,
      orderBy: { decisionMs: "asc" },
    }),
    prisma.videoAnnotation.findMany({ where: { recordingId, ...visibleAnnotationWhere(access === "owner") }, orderBy: { startMs: "asc" } }),
  ]);
  return { access, recording, recommendations, annotations };
}

async function ownedRecording(userId: string, recordingId: string) {
  await requireRecordingOwner(userId, recordingId);
  return prisma.recording.findUniqueOrThrow({ where: { id: recordingId } });
}

export async function createRecommendation(userId: string, recordingId: string, raw: unknown) {
  const rec = await ownedRecording(userId, recordingId);
  const input = recommendationInputSchema.parse(raw);
  assertWithinDuration(rec.durationMs, input.endMs);
  if (input.clipId) {
    const clip = await prisma.clip.findFirst({ where: { id: input.clipId, recordingId } });
    if (!clip) throw notFound("Clip");
  }
  return prisma.recommendation.create({
    data: {
      recordingId,
      authorId: userId,
      clipId: input.clipId ?? null,
      kind: input.kind,
      category: input.category,
      title: input.title,
      contextStartMs: input.contextStartMs,
      slowdownStartMs: input.slowdownStartMs,
      decisionMs: input.decisionMs,
      endMs: input.endMs,
      slowdownRate: input.slowdownRate,
      interpretation: input.interpretation,
      alternatives: input.alternatives,
      confidence: input.confidence,
      confidenceReason: input.confidenceReason,
      advice: input.advice,
      provenance: "MANUAL",
      analysisVersion: "manual-1",
      observations: {
        create: input.observations.map((text) => ({
          text,
          recordingId,
          timeMs: input.decisionMs,
          category: input.category,
          source: "video",
          provenance: "MANUAL",
          authorId: userId,
        })),
      },
    },
    include: recInclude,
  });
}

export async function updateRecommendation(userId: string, recommendationId: string, raw: unknown) {
  const existing = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!existing) throw notFound("Moment");
  const rec = await ownedRecording(userId, existing.recordingId);
  const input = recommendationInputSchema.parse(raw);
  assertWithinDuration(rec.durationMs, input.endMs);
  return prisma.$transaction(async (tx) => {
    await tx.observation.deleteMany({ where: { recommendationId } });
    return tx.recommendation.update({
      where: { id: recommendationId },
      data: {
        kind: input.kind,
        category: input.category,
        title: input.title,
        contextStartMs: input.contextStartMs,
        slowdownStartMs: input.slowdownStartMs,
        decisionMs: input.decisionMs,
        endMs: input.endMs,
        slowdownRate: input.slowdownRate,
        interpretation: input.interpretation,
        alternatives: input.alternatives,
        confidence: input.confidence,
        confidenceReason: input.confidenceReason,
        advice: input.advice,
        clipId: input.clipId ?? null,
        humanEdited: existing.provenance === "AUTOMATIC" ? true : undefined,
        observations: {
          create: input.observations.map((text) => ({
            text,
            recordingId: existing.recordingId,
            timeMs: input.decisionMs,
            category: input.category,
            source: "video",
            // Observation réécrite par l'utilisateur : provenance manuelle.
            provenance: "MANUAL",
            authorId: userId,
          })),
        },
      },
      include: recInclude,
    });
  });
}

export async function deleteRecommendation(userId: string, recommendationId: string) {
  const existing = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!existing) throw notFound("Moment");
  await ownedRecording(userId, existing.recordingId);
  await prisma.recommendation.delete({ where: { id: recommendationId } });
}

export async function createAnnotation(userId: string, recordingId: string, raw: unknown) {
  const rec = await ownedRecording(userId, recordingId);
  const input = annotationInputSchema.parse(raw);
  assertWithinDuration(rec.durationMs, input.endMs);
  if (input.space === "MINIMAP" && !rec.minimapRegion)
    throw badRequest("Définissez d'abord la zone de la minimap pour annoter dans cet espace.");
  if (input.recommendationId) {
    const r = await prisma.recommendation.findFirst({ where: { id: input.recommendationId, recordingId } });
    if (!r) throw notFound("Moment");
  }
  return prisma.videoAnnotation.create({
    data: {
      recordingId,
      authorId: userId,
      recommendationId: input.recommendationId ?? null,
      type: input.type,
      startMs: input.startMs,
      endMs: input.endMs,
      space: input.space,
      geometry: input.geometry,
      style: input.style,
      label: input.label ?? null,
      provenance: "MANUAL",
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
    },
  });
}

export async function updateAnnotation(userId: string, annotationId: string, raw: unknown) {
  const existing = await prisma.videoAnnotation.findUnique({ where: { id: annotationId } });
  if (!existing) throw notFound("Annotation");
  const rec = await ownedRecording(userId, existing.recordingId);
  const input = annotationInputSchema.parse(raw);
  assertWithinDuration(rec.durationMs, input.endMs);
  if (input.recommendationId) {
    const r = await prisma.recommendation.findFirst({ where: { id: input.recommendationId, recordingId: rec.id } });
    if (!r) throw notFound("Moment");
  }
  return prisma.videoAnnotation.update({
    where: { id: annotationId },
    data: {
      type: input.type,
      startMs: input.startMs,
      endMs: input.endMs,
      space: input.space,
      geometry: input.geometry,
      style: input.style,
      label: input.label ?? null,
      recommendationId: input.recommendationId ?? null,
    },
  });
}

export async function deleteAnnotation(userId: string, annotationId: string) {
  const existing = await prisma.videoAnnotation.findUnique({ where: { id: annotationId } });
  if (!existing) throw notFound("Annotation");
  await ownedRecording(userId, existing.recordingId);
  await prisma.videoAnnotation.delete({ where: { id: annotationId } });
}
