import { authed, json, readJson } from "@/server/http";
import { deleteTeam, updateTeam } from "@/server/teams/service";
import { teamDashboard } from "@/server/teams/dashboard";

type P = { id: string };

export const GET = authed<P>(async (_req, user, { id }) => json(await teamDashboard(user.id, id)));
export const PATCH = authed<P>(async (req, user, { id }) => json({ team: await updateTeam(user.id, id, await readJson(req)) }));
export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteTeam(user.id, id);
  return json({ ok: true });
});
