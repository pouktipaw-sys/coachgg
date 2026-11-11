import { authed, json } from "@/server/http";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { toggleLike } from "@/server/community";

type P = { id: string };
export const POST = authed<P>(async (_req, user, { id }) => {
  if (!rateLimit(`like:${user.id}`, 300, 3600_000)) throw new HttpError(429, "rate_limited", "Doucement 😉");
  return json(await toggleLike(user.id, id));
});
