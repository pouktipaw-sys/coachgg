import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { requireRecordingOwner } from "@/server/permissions";
import { getCoachingData } from "@/server/video/coaching";
import { deleteRecording } from "@/server/video/uploads";

type P = { id: string };

export const GET = authed<P>(async (_req, user, { id }) => {
  const data = await getCoachingData(user.id, id);
  const select = { id: true, status: true, progress: true, attempts: true, maxAttempts: true, error: true, processingMs: true, result: true, finishedAt: true, costMicros: true } as const;
  const [job, analysis] = await Promise.all([
    prisma.analysisJob.findFirst({ where: { recordingId: id, type: "PROCESS_RECORDING" }, select }),
    prisma.analysisJob.findFirst({ where: { recordingId: id, type: "ANALYZE_RECORDING" }, select }),
  ]);
  const owner = data.access === "owner";
  return json({ ...data, processingJob: owner ? job : null, analysisJob: owner ? analysis : null });
});

const unit = z.number().min(0).max(1);
const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  matchId: z.string().nullable().optional(),
  gameStartOffsetMs: z.number().int().min(-3_600_000).max(6 * 3_600_000).nullable().optional(),
  minimapRegion: z
    .object({ x: unit, y: unit, w: z.number().min(0.05).max(1), h: z.number().min(0.05).max(1) })
    .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, "La zone doit rester dans l'image.")
    .nullable()
    .optional(),
});

export const PATCH = authed<P>(async (req, user, { id }) => {
  await requireRecordingOwner(user.id, id);
  const input = patchSchema.parse(await readJson(req));
  if (input.matchId) {
    const ok = await prisma.match.count({
      where: { id: input.matchId, OR: [{ createdById: user.id }, { participants: { some: { userId: user.id } } }] },
    });
    if (!ok) throw notFound("Match");
  }
  const updated = await prisma.recording.update({
    where: { id },
    data: {
      title: input.title,
      matchId: input.matchId,
      gameStartOffsetMs: input.gameStartOffsetMs,
      minimapRegion: input.minimapRegion === null ? Prisma.DbNull : input.minimapRegion,
    },
  });
  return json({ recording: updated });
});

export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteRecording(user.id, id);
  return json({ ok: true });
});
