import { authed, json, readJson } from "@/server/http";
import { deleteClip, updateClip } from "@/server/clips";

type P = { id: string };

export const PATCH = authed<P>(async (req, user, { id }) => json({ clip: await updateClip(user.id, id, await readJson(req)) }));
export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteClip(user.id, id);
  return json({ ok: true });
});
