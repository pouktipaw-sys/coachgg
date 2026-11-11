import { authed, json, readJson } from "@/server/http";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { addComment } from "@/server/community";

type P = { id: string };
export const POST = authed<P>(async (req, user, { id }) => {
  if (!rateLimit(`comment:${user.id}`, 60, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de commentaires récents.");
  return json({ comment: await addComment(user.id, id, await readJson(req)) }, 201);
});
