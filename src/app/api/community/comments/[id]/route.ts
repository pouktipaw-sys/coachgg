import { authed, json } from "@/server/http";
import { deleteComment } from "@/server/community";

type P = { id: string };
export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteComment(user.id, id);
  return json({ ok: true });
});
