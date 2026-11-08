// Export et suppression des données personnelles.
import { prisma } from "./db";
import { storage } from "./storage";
import { verifyPassword } from "./auth/password";
import { HttpError } from "./errors";

/** Export JSON de toutes les données de l'utilisateur (hors fichiers vidéo, téléchargeables séparément). */
export async function exportUserData(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, email: true, displayName: true, createdAt: true,
      profile: true,
      gameIdentities: true,
      memberships: { include: { team: { select: { id: true, name: true } } } },
      goals: true,
      notifications: true,
      feedback: true,
      recordings: {
        include: { recommendations: { include: { observations: true } }, annotations: true, clips: true, shares: true },
      },
      participants: { include: { statistics: true, scores: true, match: true } },
    },
  });
  return { exportedAt: new Date().toISOString(), format: "coachgg-export-v1", note: "Les fichiers vidéo ne sont pas inclus.", user };
}

/** Suppression définitive : fichiers vidéo, puis compte (cascade en base). */
export async function deleteAccount(userId: string, password: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(password, user.passwordHash))) throw new HttpError(403, "bad_password", "Mot de passe incorrect.");
  // Groupes dont l'utilisateur est le seul administrateur : promouvoir un autre membre, sinon supprimer le groupe.
  const adminOf = await prisma.teamMembership.findMany({ where: { userId, role: "ADMIN" } });
  for (const m of adminOf) {
    const others = await prisma.teamMembership.findMany({ where: { teamId: m.teamId, userId: { not: userId } }, orderBy: { joinedAt: "asc" } });
    const otherAdmin = others.find((o) => o.role === "ADMIN");
    if (!otherAdmin) {
      if (others[0]) await prisma.teamMembership.update({ where: { id: others[0].id }, data: { role: "ADMIN" } });
      else await prisma.team.delete({ where: { id: m.teamId } });
    }
  }
  await prisma.analysisJob.updateMany({ where: { recording: { ownerId: userId } }, data: { cancelRequested: true } });
  await storage().deletePrefix(`recordings/${userId}/`);
  await prisma.user.delete({ where: { id: userId } });
}
