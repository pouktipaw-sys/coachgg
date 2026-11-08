import { HttpError } from "@/server/errors";
import { clientIp, handler, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/rateLimit";
import { requestPasswordReset } from "@/server/auth/service";

export const POST = handler(async (req) => {
  if (!rateLimit(`forgot:${clientIp(req)}`, 5, 3600_000))
    throw new HttpError(429, "rate_limited", "Trop de demandes, réessayez plus tard.");
  const body = (await readJson(req)) as { email?: unknown };
  await requestPasswordReset(body?.email);
  return json({ ok: true, message: "Si un compte existe pour cet email, un lien de réinitialisation a été émis." });
});
