import { authed, json } from "@/server/http";
import { deleteMatch, getMatchReport } from "@/server/matches/service";

type P = { id: string };

export const GET = authed<P>(async (_req, user, { id }) => json({ match: await getMatchReport(user.id, id) }));

export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteMatch(user.id, id);
  return json({ ok: true });
});
