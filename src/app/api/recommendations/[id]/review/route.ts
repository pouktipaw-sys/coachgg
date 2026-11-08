import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { reviewRecommendation } from "@/server/analysis/review";

type P = { id: string };

export const POST = authed<P>(async (req, user, { id }) => {
  const { action, comment } = z
    .object({ action: z.enum(["validate", "reject"]), comment: z.string().trim().max(1000).optional() })
    .parse(await readJson(req));
  return json({ recommendation: await reviewRecommendation(user.id, id, action, comment) });
});
