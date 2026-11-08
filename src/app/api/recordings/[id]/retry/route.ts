import { authed, json } from "@/server/http";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/errors";
import { requireRecordingOwner } from "@/server/permissions";
import { enqueueJob, retryJob } from "@/server/jobs";

type P = { id: string };

/** Relance le traitement d'une vidéo dont l'envoi est complet mais le traitement a échoué. */
export const POST = authed<P>(async (_req, user, { id }) => {
  await requireRecordingOwner(user.id, id);
  const rec = await prisma.recording.findUniqueOrThrow({ where: { id } });
  if (Number(rec.receivedBytes) !== Number(rec.sizeBytes))
    throw new HttpError(409, "incomplete", "L'envoi n'est pas terminé : reprenez l'envoi du fichier.");
  if (rec.status === "READY") throw new HttpError(409, "ready", "La vidéo est déjà prête.");
  const job = await enqueueJob({ type: "PROCESS_RECORDING", idempotencyKey: `process:${id}`, recordingId: id });
  if (["FAILED", "CANCELLED"].includes(job.status)) await retryJob(job.id);
  await prisma.recording.update({ where: { id }, data: { status: "UPLOADED", errorMessage: null } });
  return json({ ok: true });
});
