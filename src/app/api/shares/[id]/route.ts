import { authed, json } from "@/server/http";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";

type P = { id: string };

/** Retrait d'un partage : effet immédiat (les contrôles d'accès sont faits à chaque requête). */
export const DELETE = authed<P>(async (_req, user, { id }) => {
  const share = await prisma.sharePermission.findUnique({ where: { id }, include: { recording: { select: { ownerId: true } } } });
  if (!share || share.recording.ownerId !== user.id) throw notFound("Partage");
  await prisma.sharePermission.update({ where: { id }, data: { revokedAt: new Date() } });
  return json({ ok: true });
});
