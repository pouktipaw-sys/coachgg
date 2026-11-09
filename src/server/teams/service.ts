// Groupes d'amis « CoachGG Team » : création, invitations privées, rôles, départ.
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, badRequest, notFound } from "../errors";
import { requireTeamAdmin, requireTeamMember } from "../permissions";
import { notify } from "../notifications";
import { syncTeamReports } from "../scores";
import { sendMail } from "../mailer";
import { newToken, sha256 } from "../auth/session";
import { env } from "@/lib/env";

const INVITE_DAYS = 14;
const MAX_PENDING_EMAIL_INVITES = 50;

export const teamSchema = z.object({
  name: z.string().trim().min(2).max(50),
  description: z.string().trim().max(300).nullish(),
  imageUrl: z.string().trim().url().max(500).regex(/^https:\/\//, "Image en https uniquement").nullish(),
});

export async function createTeam(userId: string, raw: unknown) {
  const input = teamSchema.parse(raw);
  const count = await prisma.teamMembership.count({ where: { userId } });
  if (count >= 20) throw new HttpError(429, "too_many_teams", "Limite de 20 groupes atteinte.");
  return prisma.team.create({
    data: { ...input, createdById: userId, memberships: { create: { userId, role: "ADMIN" } } },
  });
}

export async function updateTeam(userId: string, teamId: string, raw: unknown) {
  await requireTeamAdmin(userId, teamId);
  return prisma.team.update({ where: { id: teamId }, data: teamSchema.partial().parse(raw) });
}

export async function deleteTeam(userId: string, teamId: string) {
  await requireTeamAdmin(userId, teamId);
  await prisma.team.delete({ where: { id: teamId } });
}

/**
 * Invitation privée par email.
 * • Compte existant : invitation interne + notification + email.
 * • Pas de compte : email contenant un lien d'inscription à usage unique ; l'invitation
 *   devient une invitation normale (à accepter) quand la personne s'inscrit avec ce lien.
 * La réponse est toujours la même : on ne révèle pas si un email possède un compte.
 */
export async function inviteToTeam(userId: string, teamId: string, rawEmail: unknown) {
  await requireTeamAdmin(userId, teamId);
  const email = z.string().trim().toLowerCase().email().parse(rawEmail);
  const generic = { ok: true, message: "Invitation envoyée. Si cette personne n'a pas encore de compte, elle recevra un lien d'inscription par email." };
  const [invitee, team, inviter] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true, email: true } }),
  ]);
  if (email === inviter.email) return generic;
  if (!invitee) {
    await inviteByEmail(userId, inviter.displayName, team, email);
    return generic;
  }
  if (await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: invitee.id } } })) return generic;
  const pending = await prisma.teamInvitation.findFirst({ where: { teamId, inviteeId: invitee.id, status: "PENDING", expiresAt: { gt: new Date() } } });
  if (pending) return generic;
  await prisma.teamInvitation.create({
    data: { teamId, inviterId: userId, inviteeId: invitee.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) },
  });
  await notify(invitee.id, { type: "team_invitation", title: "Invitation à un groupe", body: `Vous êtes invité à rejoindre « ${team.name} ».`, link: "/app/invitations" });
  await sendMail({
    to: invitee.email,
    subject: `CoachGG — invitation au groupe « ${team.name} »`,
    text: `${inviter.displayName} vous invite à rejoindre le groupe « ${team.name} » sur CoachGG.\n\nRépondre à l'invitation : ${env.appUrl}/app/invitations\n\nL'invitation expire dans ${INVITE_DAYS} jours. Rejoindre un groupe ne partage jamais vos vidéos privées.`,
  });
  return generic;
}

async function inviteByEmail(inviterId: string, inviterName: string, team: { id: string; name: string }, email: string) {
  const now = new Date();
  const active = { teamId: team.id, consumedAt: null, expiresAt: { gt: now } };
  if (await prisma.teamEmailInvite.findFirst({ where: { ...active, email } })) return; // déjà invitée
  if ((await prisma.teamEmailInvite.count({ where: active })) >= MAX_PENDING_EMAIL_INVITES)
    throw new HttpError(429, "too_many_invites", "Trop d'invitations par email en attente pour ce groupe.");
  const token = newToken();
  await prisma.teamEmailInvite.create({
    data: { id: sha256(token), teamId: team.id, email, inviterId, expiresAt: new Date(now.getTime() + INVITE_DAYS * 86400_000) },
  });
  await sendMail({
    to: email,
    subject: `CoachGG — ${inviterName} vous invite dans « ${team.name} »`,
    text: `${inviterName} vous invite à rejoindre son groupe « ${team.name} » sur CoachGG, l'outil de coaching League of Legends après match.\n\nCréer votre compte avec ce lien (valable ${INVITE_DAYS} jours, à usage unique) :\n${env.appUrl}/register?invite=${token}\n\nCoachGG ne demande jamais votre mot de passe Riot. Si vous ne connaissez pas cette personne, ignorez cet email.`,
  });
}

/**
 * À l'inscription : le jeton reçu par email prouve la possession de l'adresse.
 * Il est converti en invitation normale, que la personne accepte ou refuse ensuite.
 * Un jeton invalide, expiré, déjà utilisé ou destiné à une autre adresse est ignoré.
 */
export async function consumeEmailInvite(userId: string, email: string, token: string | undefined) {
  if (!token) return null;
  const inv = await prisma.teamEmailInvite.findUnique({ where: { id: sha256(token) } });
  if (!inv || inv.consumedAt || inv.expiresAt < new Date() || inv.email !== email.toLowerCase()) return null;
  const team = await prisma.team.findUnique({ where: { id: inv.teamId } });
  const consumed = await prisma.teamEmailInvite.updateMany({ where: { id: inv.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (!team || consumed.count === 0) return null;
  const inviterStillAdmin = await prisma.teamMembership.findFirst({ where: { teamId: team.id, userId: inv.inviterId, role: "ADMIN" } });
  if (!inviterStillAdmin) return null;
  const created = await prisma.teamInvitation.create({
    data: { teamId: team.id, inviterId: inv.inviterId, inviteeId: userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) },
  });
  await notify(userId, { type: "team_invitation", title: "Invitation à un groupe", body: `Vous êtes invité à rejoindre « ${team.name} ».`, link: "/app/invitations" });
  return created;
}

export async function respondInvitation(userId: string, invitationId: string, accept: boolean) {
  const inv = await prisma.teamInvitation.findUnique({ where: { id: invitationId } });
  if (!inv || inv.inviteeId !== userId) throw notFound("Invitation");
  if (inv.status !== "PENDING") throw badRequest("Invitation déjà traitée.");
  if (inv.expiresAt < new Date()) throw badRequest("Invitation expirée.");
  await prisma.$transaction(async (tx) => {
    await tx.teamInvitation.update({ where: { id: inv.id }, data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() } });
    if (accept) {
      await tx.teamMembership.upsert({
        where: { teamId_userId: { teamId: inv.teamId, userId } },
        update: {},
        create: { teamId: inv.teamId, userId, role: "MEMBER" },
      });
    }
  });
  if (accept) await syncTeamReports(inv.teamId);
  return { teamId: inv.teamId };
}

export async function revokeInvitation(userId: string, invitationId: string) {
  const inv = await prisma.teamInvitation.findUnique({ where: { id: invitationId } });
  if (!inv) throw notFound("Invitation");
  await requireTeamAdmin(userId, inv.teamId);
  await prisma.teamInvitation.update({ where: { id: inv.id }, data: { status: "REVOKED", respondedAt: new Date() } });
}

/** Quitter : le dernier administrateur doit transmettre son rôle (ou le groupe est supprimé s'il est seul). */
export async function leaveTeam(userId: string, teamId: string) {
  const m = await requireTeamMember(userId, teamId);
  const others = await prisma.teamMembership.findMany({ where: { teamId, userId: { not: userId } }, orderBy: { joinedAt: "asc" } });
  if (others.length === 0) {
    await prisma.team.delete({ where: { id: teamId } });
    return { deleted: true };
  }
  if (m.role === "ADMIN" && !others.some((o) => o.role === "ADMIN")) {
    await prisma.teamMembership.update({ where: { id: others[0]!.id }, data: { role: "ADMIN" } });
  }
  await removeMembership(teamId, userId);
  return { deleted: false };
}

export async function removeMember(adminId: string, teamId: string, memberId: string) {
  await requireTeamAdmin(adminId, teamId);
  if (adminId === memberId) throw badRequest("Utilisez « Quitter le groupe ».");
  const m = await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: memberId } } });
  if (!m) throw notFound("Membre");
  await removeMembership(teamId, memberId);
}

/** Retire un membre ; ses partages vers le groupe deviennent inopérants pour lui (contrôle à chaque accès). */
async function removeMembership(teamId: string, userId: string) {
  await prisma.teamMembership.delete({ where: { teamId_userId: { teamId, userId } } });
  // Les vidéos qu'il avait partagées avec ce groupe ne le sont plus.
  await prisma.sharePermission.updateMany({
    where: { granteeTeamId: teamId, revokedAt: null, recording: { ownerId: userId } },
    data: { revokedAt: new Date() },
  });
  await syncTeamReports(teamId);
}

export async function setMemberRole(adminId: string, teamId: string, memberId: string, role: "ADMIN" | "MEMBER") {
  await requireTeamAdmin(adminId, teamId);
  const m = await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: memberId } } });
  if (!m) throw notFound("Membre");
  if (role === "MEMBER") {
    const admins = await prisma.teamMembership.count({ where: { teamId, role: "ADMIN" } });
    if (admins <= 1 && m.role === "ADMIN") throw badRequest("Le groupe doit garder au moins un administrateur.");
  }
  return prisma.teamMembership.update({ where: { id: m.id }, data: { role } });
}
