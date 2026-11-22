import { cookies } from "next/headers";
import { authed, json, readJson } from "@/server/http";
import { changePassword } from "@/server/auth/service";
import { SESSION_COOKIE } from "@/server/auth/session";

export const PATCH = authed(async (req, user) => {
  await changePassword(user.id, (await cookies()).get(SESSION_COOKIE)?.value, await readJson(req));
  return json({ ok: true });
});
