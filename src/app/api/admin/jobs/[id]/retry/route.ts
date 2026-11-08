import { authed, json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { retryJob } from "@/server/jobs";
import { prisma } from "@/server/db";

type P = { id: string };

export const POST = authed<P>(async (_req, user, { id }) => {
  requireAdmin(user);
  const job = await retryJob(id);
  if (job.recordingId) await prisma.recording.update({ where: { id: job.recordingId }, data: { status: "UPLOADED", errorMessage: null } });
  return json({ ok: true });
});
