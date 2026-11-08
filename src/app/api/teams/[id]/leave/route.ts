import { authed, json } from "@/server/http";
import { leaveTeam } from "@/server/teams/service";

type P = { id: string };

export const POST = authed<P>(async (_req, user, { id }) => json(await leaveTeam(user.id, id)));
