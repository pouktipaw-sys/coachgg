import { authed, json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { prisma } from "@/server/db";

type P = { id: string };

export const POST = authed<P>(async (_req, user, { id }) => {
  requireAdmin(user);
  await prisma.analysisFeedback.update({ where: { id }, data: { resolvedAt: new Date() } });
  return json({ ok: true });
});
