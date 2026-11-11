import { authed, json, readJson } from "@/server/http";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { listFriends, pendingFriendRequests, sendFriendRequest } from "@/server/friends";

export const GET = authed(async (_req, user) => json({ friends: await listFriends(user.id), requests: await pendingFriendRequests(user.id) }));

export const POST = authed(async (req, user) => {
  if (!rateLimit(`friend-req:${user.id}`, 30, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de demandes d'ami envoyées.");
  return json(await sendFriendRequest(user.id, await readJson(req)), 201);
});
