import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { deleteAccount } from "@/server/account";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth/session";

export const DELETE = authed(async (req, user) => {
  const { password } = z.object({ password: z.string().min(1) }).parse(await readJson(req));
  await deleteAccount(user.id, password);
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
});
