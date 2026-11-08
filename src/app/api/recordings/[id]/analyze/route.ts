import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { requireRecordingOwner } from "@/server/permissions";
import { CONTEXT_CHOICES, requestAnalysis } from "@/server/analysis/job";

type P = { id: string };

/** Lance ou relance l'analyse assistée (durée de contexte réglable). */
export const POST = authed<P>(async (req, user, { id }) => {
  await requireRecordingOwner(user.id, id);
  const { contextSec } = z
    .object({ contextSec: z.number().int().refine((n) => (CONTEXT_CHOICES as readonly number[]).includes(n)).default(10) })
    .parse(await readJson(req));
  if (!rateLimit(`analyze:${user.id}`, 20, 3600_000)) throw new HttpError(429, "rate_limited", "Trop d'analyses lancées récemment.");
  const rec = await prisma.recording.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (rec.status !== "READY") throw new HttpError(409, "not_ready", "La vidéo doit être prête avant l'analyse.");
  const job = await requestAnalysis(id, contextSec);
  return json({ job: { id: job.id, status: job.status } }, 202);
});

/** Annule l'analyse en cours ou en attente (sans toucher à la vidéo). */
export const DELETE = authed<P>(async (_req, user, { id }) => {
  await requireRecordingOwner(user.id, id);
  await prisma.analysisJob.updateMany({
    where: { recordingId: id, type: "ANALYZE_RECORDING", status: "PENDING" },
    data: { status: "CANCELLED", cancelRequested: true, finishedAt: new Date() },
  });
  await prisma.analysisJob.updateMany({ where: { recordingId: id, type: "ANALYZE_RECORDING", status: "RUNNING" }, data: { cancelRequested: true } });
  return json({ ok: true });
});
