import { authed } from "@/server/http";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { canSeeRecommendation } from "@/server/analysis/review";
import { storage } from "@/server/storage";

type P = { id: string };

/** Planche d'images du contexte précédant l'événement (mêmes droits que le moment). */
export const GET = authed<P>(async (_req, user, { id }) => {
  if (!(await canSeeRecommendation(user.id, id))) throw notFound("Planche");
  const r = await prisma.recommendation.findUnique({ where: { id }, select: { contextSheetKey: true } });
  const size = r?.contextSheetKey ? await storage().size(r.contextSheetKey) : null;
  if (!r?.contextSheetKey || size == null) throw notFound("Planche");
  return new Response(storage().readStream(r.contextSheetKey), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(size), "Cache-Control": "private, max-age=3600" },
  });
});
