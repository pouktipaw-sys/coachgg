import { authed, json } from "@/server/http";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { importRiotDeaths } from "@/server/analysis/evaluation";
import { RiotApiError, RiotNotConfiguredError } from "@/server/riot/client";

type P = { id: string };

export const POST = authed<P>(async (_req, user, { id }) => {
  if (!rateLimit(`riot-timeline:${user.id}`, 20, 3600_000)) throw new HttpError(429, "rate_limited", "Trop d'imports récents.");
  try {
    return json(await importRiotDeaths(user.id, id));
  } catch (e) {
    if (e instanceof RiotNotConfiguredError) throw new HttpError(503, "riot_not_configured", e.message);
    if (e instanceof RiotApiError) throw new HttpError(502, "riot_error", e.message);
    throw e;
  }
});
