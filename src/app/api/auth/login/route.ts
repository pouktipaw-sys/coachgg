import { HttpError } from "@/server/errors";
import { clientIp, handler, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/rateLimit";
import { login } from "@/server/auth/service";
import { setSessionCookie } from "@/server/auth/session";

export const POST = handler(async (req) => {
  if (!rateLimit(`login:${clientIp(req)}`, 20, 15 * 60_000))
    throw new HttpError(429, "rate_limited", "Trop de tentatives, réessayez dans quelques minutes.");
  const { user, session } = await login(await readJson(req));
  await setSessionCookie(session.token, session.expiresAt);
  return json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
});
