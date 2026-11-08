import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";

export const GET = authed(async (_req, user) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return json({ items, unread });
});

/** Marque des notifications (ou toutes) comme lues. */
export const POST = authed(async (req, user) => {
  const { ids } = z.object({ ids: z.array(z.string()).max(200).optional() }).parse(await readJson(req));
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return json({ ok: true });
});
