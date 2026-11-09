import { authed, json } from "@/server/http";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { refreshRank } from "@/server/riot/import";
import { RiotApiError, RiotNotConfiguredError } from "@/server/riot/client";

type P = { id: string };

export const POST = authed<P>(async (_req, user, { id }) => {
  if (!rateLimit(`rank:${user.id}`, 10, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de mises à jour récentes.");
  try {
    return json({ identity: await refreshRank(user.id, id) });
  } catch (e) {
    if (e instanceof RiotNotConfiguredError) throw new HttpError(503, "riot_not_configured", e.message);
    if (e instanceof RiotApiError) throw new HttpError(e.status === 404 ? 404 : 502, "riot_error", e.message);
    throw e;
  }
});
