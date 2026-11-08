import { handler, json } from "@/server/http";
import { destroyCurrentSession } from "@/server/auth/session";

export const POST = handler(async () => {
  await destroyCurrentSession();
  return json({ ok: true });
});
