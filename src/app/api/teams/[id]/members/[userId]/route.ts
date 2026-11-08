import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { removeMember, setMemberRole } from "@/server/teams/service";

type P = { id: string; userId: string };

export const PATCH = authed<P>(async (req, user, { id, userId }) => {
  const { role } = z.object({ role: z.enum(["ADMIN", "MEMBER"]) }).parse(await readJson(req));
  return json({ membership: await setMemberRole(user.id, id, userId, role) });
});

export const DELETE = authed<P>(async (_req, user, { id, userId }) => {
  await removeMember(user.id, id, userId);
  return json({ ok: true });
});
