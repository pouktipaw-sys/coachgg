import { HttpError } from "@/server/errors";
import { clientIp, handler, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/rateLimit";
import { register } from "@/server/auth/service";
import { setSessionCookie } from "@/server/auth/session";

export const POST = handler(async (req) => {
  if (!rateLimit(`register:${clientIp(req)}`, 10, 3600_000))
    throw new HttpError(429, "rate_limited", "Trop de tentatives, réessayez plus tard.");
  const { user, session, teamInvitation } = await register(await readJson(req));
  await setSessionCookie(session.token, session.expiresAt);
  return json({ user: { id: user.id, email: user.email, displayName: user.displayName }, teamInvitation: !!teamInvitation }, 201);
});
