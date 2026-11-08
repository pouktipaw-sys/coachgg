import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";
import { requireRecordingView } from "@/server/permissions";
import { notFound } from "@/server/errors";

const schema = z.object({
  recommendationId: z.string(),
  kind: z.enum(["INCORRECT", "UNCLEAR", "HELPFUL", "CORRECTION"]),
  comment: z.string().trim().max(1000).optional(),
});

/** Signalement d'un diagnostic incorrect / peu clair, ou proposition de correction. */
export const POST = authed(async (req, user) => {
  const input = schema.parse(await readJson(req));
  const rec = await prisma.recommendation.findUnique({ where: { id: input.recommendationId } });
  if (!rec) throw notFound("Moment");
  await requireRecordingView(user.id, rec.recordingId);
  const fb = await prisma.analysisFeedback.create({
    data: { userId: user.id, recommendationId: rec.id, kind: input.kind, comment: input.comment },
  });
  if (input.kind === "INCORRECT") {
    await prisma.recommendation.update({ where: { id: rec.id }, data: { status: "DISPUTED" } });
  }
  return json({ feedback: fb }, 201);
});
