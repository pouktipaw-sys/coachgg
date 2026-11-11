import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { removeFriend, respondFriendRequest } from "@/server/friends";

type P = { id: string };
export const PATCH = authed<P>(async (req, user, { id }) => {
  const { accept } = z.object({ accept: z.boolean() }).parse(await readJson(req));
  await respondFriendRequest(user.id, id, accept);
  return json({ ok: true });
});
export const DELETE = authed<P>(async (_req, user, { id }) => {
  await removeFriend(user.id, id);
  return json({ ok: true });
});
