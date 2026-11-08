import { handler, json, readJson } from "@/server/http";
import { resetPassword } from "@/server/auth/service";

export const POST = handler(async (req) => {
  await resetPassword(await readJson(req));
  return json({ ok: true });
});
