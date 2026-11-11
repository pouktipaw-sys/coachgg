import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { moderate } from "@/server/community";

type P = { id: string };
export const POST = authed<P>(async (req, user, { id }) => {
  const { action } = z.object({ action: z.enum(["hide", "dismiss"]) }).parse(await readJson(req));
  await moderate(user.id, id, action);
  return json({ ok: true });
});
