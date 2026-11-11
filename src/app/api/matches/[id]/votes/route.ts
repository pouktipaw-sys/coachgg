import { authed, json, readJson } from "@/server/http";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { submitBallot, voteBoard } from "@/server/peerVotes";

type P = { id: string };
export const GET = authed<P>(async (_req, user, { id }) => json(await voteBoard(user.id, id)));
export const PUT = authed<P>(async (req, user, { id }) => {
  if (!rateLimit(`vote:${user.id}`, 60, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de votes récents.");
  return json(await submitBallot(user.id, id, await readJson(req)));
});
