import { HttpError } from "@/server/errors";
import { clientIp, handler, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/rateLimit";
import { pairDevice } from "@/server/devices";

/** Appelé par l'application PC : échange un code d'appairage contre un jeton d'appareil. */
export const POST = handler(async (req) => {
  if (!rateLimit(`pair:${clientIp(req)}`, 10, 15 * 60_000)) throw new HttpError(429, "rate_limited", "Trop de tentatives d'appairage.");
  return json(await pairDevice(await readJson(req)), 201);
});
