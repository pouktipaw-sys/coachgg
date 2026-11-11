import { authed, json } from "@/server/http";
import { deletePost, getPost } from "@/server/community";

type P = { id: string };
export const GET = authed<P>(async (_req, user, { id }) => json(await getPost(user.id, id)));
export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deletePost(user.id, id);
  return json({ ok: true });
});
