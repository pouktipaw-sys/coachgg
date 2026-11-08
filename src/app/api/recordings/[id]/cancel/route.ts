import { authed, json } from "@/server/http";
import { prisma } from "@/server/db";
import { requireRecordingOwner } from "@/server/permissions";

type P = { id: string };

/** Demande l'annulation du traitement en cours (le worker interrompt FFmpeg). */
export const POST = authed<P>(async (_req, user, { id }) => {
  await requireRecordingOwner(user.id, id);
  const pending = await prisma.analysisJob.updateMany({
    where: { recordingId: id, status: "PENDING" },
    data: { status: "CANCELLED", cancelRequested: true, finishedAt: new Date() },
  });
  const running = await prisma.analysisJob.updateMany({
    where: { recordingId: id, status: "RUNNING" },
    data: { cancelRequested: true },
  });
  if (pending.count > 0) {
    await prisma.recording.update({ where: { id }, data: { status: "FAILED", errorMessage: "Traitement annulé." } });
  }
  return json({ ok: true, cancelled: pending.count, stopping: running.count });
});
