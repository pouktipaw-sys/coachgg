import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { importRecentMatches } from "@/server/riot/import";
import { RiotApiError, RiotNotConfiguredError } from "@/server/riot/client";

export const POST = authed(async (req, user) => {
  const { count } = z.object({ count: z.number().int().min(1).max(20).default(5) }).parse(await readJson(req));
  if (!rateLimit(`riot-import:${user.id}`, 6, 3600_000)) throw new HttpError(429, "rate_limited", "Trop d'imports récents.");
  try {
    return json({ results: await importRecentMatches(user.id, count) });
  } catch (e) {
    if (e instanceof RiotNotConfiguredError) throw new HttpError(503, "riot_not_configured", e.message);
    if (e instanceof RiotApiError) throw new HttpError(e.status === 404 ? 404 : 502, "riot_error", e.message);
    throw e;
  }
});
