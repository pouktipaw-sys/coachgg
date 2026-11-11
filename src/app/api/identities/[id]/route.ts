import { authed, json } from "@/server/http";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";

type P = { id: string };

export const DELETE = authed<P>(async (_req, user, { id }) => {
  const identity = await prisma.gameIdentity.findFirst({ where: { id, userId: user.id } });
  if (!identity) throw notFound("Identité");
  await prisma.gameIdentity.delete({ where: { id } });
  // Le compte principal retiré : le plus ancien des comptes restants le devient.
  if (identity.isPrimary) {
    const next = await prisma.gameIdentity.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    if (next) await prisma.gameIdentity.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
  return json({ ok: true });
});

/** Définit ce compte Riot comme compte principal (affiché sur le profil, les amis, le classement). */
export const PATCH = authed<P>(async (_req, user, { id }) => {
  const identity = await prisma.gameIdentity.findFirst({ where: { id, userId: user.id } });
  if (!identity) throw notFound("Identité");
  await prisma.$transaction([
    prisma.gameIdentity.updateMany({ where: { userId: user.id }, data: { isPrimary: false } }),
    prisma.gameIdentity.update({ where: { id }, data: { isPrimary: true } }),
  ]);
  return json({ ok: true });
});
