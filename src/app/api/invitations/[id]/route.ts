import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { respondInvitation, revokeInvitation } from "@/server/teams/service";

type P = { id: string };

export const POST = authed<P>(async (req, user, { id }) => {
  const { accept } = z.object({ accept: z.boolean() }).parse(await readJson(req));
  return json(await respondInvitation(user.id, id, accept));
});

export const DELETE = authed<P>(async (_req, user, { id }) => {
  await revokeInvitation(user.id, id);
  return json({ ok: true });
});
