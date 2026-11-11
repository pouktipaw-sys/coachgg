import { authed, json } from "@/server/http";
import { removeTeammate } from "@/server/teammates";

type P = { id: string };
export const DELETE = authed<P>(async (_req, user, { id }) => {
  await removeTeammate(user.id, id);
  return json({ ok: true });
});
