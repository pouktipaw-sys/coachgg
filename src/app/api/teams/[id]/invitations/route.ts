import { HttpError } from "@/server/errors";
import { authed, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/rateLimit";
import { inviteToTeam } from "@/server/teams/service";

type P = { id: string };

export const POST = authed<P>(async (req, user, { id }) => {
  if (!rateLimit(`invite:${user.id}`, 30, 3600_000)) throw new HttpError(429, "rate_limited", "Trop d'invitations envoyées.");
  const body = (await readJson(req)) as { email?: unknown };
  return json(await inviteToTeam(user.id, id, body?.email));
});
