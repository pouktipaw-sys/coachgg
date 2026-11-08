import { authed, json } from "@/server/http";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";

type P = { id: string };

export const DELETE = authed<P>(async (_req, user, { id }) => {
  const r = await prisma.gameIdentity.deleteMany({ where: { id, userId: user.id } });
  if (!r.count) throw notFound("Identité");
  return json({ ok: true });
});
