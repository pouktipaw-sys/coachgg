import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";
import { canSeeRecommendation } from "@/server/analysis/review";
import { notFound } from "@/server/errors";

const schema = z.object({
  recommendationId: z.string(),
  kind: z.enum(["INCORRECT", "UNCLEAR", "HELPFUL", "CORRECTION"]),
  comment: z.string().trim().max(1000).optional(),
});

/** Signalement d'un diagnostic incorrect / peu clair, ou proposition de correction. */
export const POST = authed(async (req, user) => {
  const input = schema.parse(await readJson(req));
  const rec = await canSeeRecommendation(user.id, input.recommendationId);
  if (!rec) throw notFound("Moment");
  const fb = await prisma.analysisFeedback.create({
    data: { userId: user.id, recommendationId: input.recommendationId, kind: input.kind, comment: input.comment },
  });
  // Un brouillon signalé reste un brouillon (DISPUTED rendrait le moment visible aux partages).
  if (input.kind === "INCORRECT" && rec.status === "PUBLISHED") {
    await prisma.recommendation.update({ where: { id: input.recommendationId }, data: { status: "DISPUTED" } });
  }
  return json({ feedback: fb }, 201);
});
