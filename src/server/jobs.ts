// File de tâches persistante sur PostgreSQL (FOR UPDATE SKIP LOCKED).
// Pas de Redis/broker supplémentaire en V1 : une seule dépendance d'infra.
import type { AnalysisJob, JobType, Prisma } from "@prisma/client";
import { prisma } from "./db";

export const STALE_LOCK_MS = 15 * 60 * 1000;

/** Idempotent : une même clé ne crée qu'une seule tâche. */
export async function enqueueJob(input: {
  type: JobType;
  idempotencyKey: string;
  recordingId?: string;
  matchId?: string;
  payload?: Prisma.InputJsonValue;
  maxAttempts?: number;
}): Promise<AnalysisJob> {
  return prisma.analysisJob.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      recordingId: input.recordingId,
      matchId: input.matchId,
      payload: input.payload,
      maxAttempts: input.maxAttempts ?? 3,
    },
  });
}

/** Réserve atomiquement la prochaine tâche exécutable (ou une tâche abandonnée). */
export async function claimNextJob(workerId: string): Promise<AnalysisJob | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "AnalysisJob" SET
      status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId},
      attempts = attempts + 1, "startedAt" = now(), "updatedAt" = now(), error = NULL
    WHERE id = (
      SELECT id FROM "AnalysisJob"
      WHERE "cancelRequested" = false AND (
        (status = 'PENDING' AND "runAfter" <= now())
        OR (status = 'RUNNING' AND "lockedAt" < now() - (${STALE_LOCK_MS} * interval '1 millisecond'))
      )
      ORDER BY "runAfter" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  const id = rows[0]?.id;
  return id ? prisma.analysisJob.findUnique({ where: { id } }) : null;
}

export class PermanentJobError extends Error {}
export class JobCancelledError extends Error {}

export async function completeJob(job: AnalysisJob, result: Prisma.InputJsonValue, status: "SUCCEEDED" | "PARTIAL" | "NEEDS_REVIEW" = "SUCCEEDED") {
  const startedAt = job.startedAt ?? new Date();
  await prisma.analysisJob.update({
    where: { id: job.id },
    data: {
      status,
      result,
      progress: 100,
      finishedAt: new Date(),
      processingMs: Date.now() - startedAt.getTime(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

/** Échec : nouvelle tentative avec backoff exponentiel, sauf erreur permanente. */
export async function failJob(job: AnalysisJob, err: unknown): Promise<"retry" | "failed" | "cancelled"> {
  const message = err instanceof Error ? err.message : String(err);
  const startedAt = job.startedAt ?? new Date();
  const base = { lockedAt: null, lockedBy: null, error: message.slice(0, 2000), processingMs: Date.now() - startedAt.getTime() };
  if (err instanceof JobCancelledError) {
    await prisma.analysisJob.update({ where: { id: job.id }, data: { ...base, status: "CANCELLED", finishedAt: new Date() } });
    return "cancelled";
  }
  const permanent = err instanceof PermanentJobError;
  if (!permanent && job.attempts < job.maxAttempts) {
    const delayMs = Math.min(10 * 60_000, 5_000 * 2 ** (job.attempts - 1));
    await prisma.analysisJob.update({
      where: { id: job.id },
      data: { ...base, status: "PENDING", runAfter: new Date(Date.now() + delayMs) },
    });
    return "retry";
  }
  await prisma.analysisJob.update({ where: { id: job.id }, data: { ...base, status: "FAILED", finishedAt: new Date() } });
  return "failed";
}

/** Relance manuelle d'une tâche échouée (bouton « Réessayer »). */
export async function retryJob(jobId: string) {
  return prisma.analysisJob.update({
    where: { id: jobId },
    data: { status: "PENDING", attempts: 0, runAfter: new Date(), error: null, cancelRequested: false, progress: 0 },
  });
}

export async function setJobProgress(jobId: string, progress: number) {
  const job = await prisma.analysisJob.update({
    where: { id: jobId },
    data: { progress: Math.max(0, Math.min(99, Math.round(progress))), lockedAt: new Date() },
    select: { cancelRequested: true },
  });
  if (job.cancelRequested) throw new JobCancelledError("Traitement annulé par l'utilisateur.");
}
