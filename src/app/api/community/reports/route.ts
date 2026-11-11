import { authed, json, readJson } from "@/server/http";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { report } from "@/server/community";

export const POST = authed(async (req, user) => {
  if (!rateLimit(`report:${user.id}`, 30, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de signalements récents.");
  await report(user.id, await readJson(req));
  return json({ ok: true, message: "Merci, la modération va regarder." }, 201);
});
