import { authed, json, readJson } from "@/server/http";
import { createRecommendation } from "@/server/video/coaching";

type P = { id: string };

export const POST = authed<P>(async (req, user, { id }) =>
  json({ recommendation: await createRecommendation(user.id, id, await readJson(req)) }, 201),
);
