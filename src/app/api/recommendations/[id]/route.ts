import { authed, json, readJson } from "@/server/http";
import { deleteRecommendation, updateRecommendation } from "@/server/video/coaching";

type P = { id: string };

export const PUT = authed<P>(async (req, user, { id }) =>
  json({ recommendation: await updateRecommendation(user.id, id, await readJson(req)) }),
);

export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteRecommendation(user.id, id);
  return json({ ok: true });
});
