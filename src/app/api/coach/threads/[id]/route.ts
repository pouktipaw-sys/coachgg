import { authed, json } from "@/server/http";
import { deleteThread, getThread } from "@/server/coach/service";

type P = { id: string };

export const GET = authed<P>(async (_req, user, { id }) => json(await getThread(user.id, id)));
export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteThread(user.id, id);
  return json({ ok: true });
});
