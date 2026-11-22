import { z } from "zod";
import { prisma } from "../db";
import { HttpError, badRequest } from "../errors";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./password";
import { createSession, newToken, sha256 } from "./session";
import { sendMail } from "../mailer";
import { consumeEmailInvite } from "../teams/service";
import { env } from "@/lib/env";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().max(200),
  displayName: z.string().trim().min(2).max(40),
  inviteToken: z.string().max(200).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export async function register(raw: unknown) {
  const input = registerSchema.parse(raw);
  const weak = validatePasswordStrength(input.password);
  if (weak) throw badRequest(weak);
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) throw new HttpError(409, "email_taken", "Un compte existe déjà avec cet email.");
  const { inviteToken } = input;
  const user = await prisma.user.create({
    data: {
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
      profile: { create: {} },
    },
  });
  const teamInvitation = await consumeEmailInvite(user.id, user.email, inviteToken);
  return { user, session: await createSession(user.id), teamInvitation };
}

// Hash factice pour égaliser le temps de réponse si l'email n'existe pas.
let dummyHash: Promise<string> | null = null;

export async function login(raw: unknown) {
  const input = loginSchema.parse(raw);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    dummyHash ??= hashPassword("dummy-password-for-timing");
    await verifyPassword(input.password, await dummyHash);
    throw new HttpError(401, "invalid_credentials", "Email ou mot de passe incorrect.");
  }
  if (!(await verifyPassword(input.password, user.passwordHash)))
    throw new HttpError(401, "invalid_credentials", "Email ou mot de passe incorrect.");
  return { user, session: await createSession(user.id) };
}

/** Réponse identique que le compte existe ou non (pas d'énumération). */
export async function requestPasswordReset(rawEmail: unknown) {
  const email = z.string().trim().toLowerCase().email().parse(rawEmail);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  const token = newToken();
  await prisma.passwordResetToken.create({
    data: { id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
  });
  await sendMail({
    to: user.email,
    subject: "CoachGG — réinitialisation du mot de passe",
    text: `Lien valable 1 heure : ${env.appUrl}/reset-password?token=${token}`,
  });
}

export async function resetPassword(raw: unknown) {
  const input = z.object({ token: z.string().min(10), password: z.string().max(200) }).parse(raw);
  const weak = validatePasswordStrength(input.password);
  if (weak) throw badRequest(weak);
  const rec = await prisma.passwordResetToken.findUnique({ where: { id: sha256(input.token) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw badRequest("Lien invalide ou expiré.");
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: rec.userId }, data: { passwordHash: await hashPassword(input.password) } }),
    prisma.session.deleteMany({ where: { userId: rec.userId } }), // déconnecte toutes les sessions
  ]);
}

// ── Gestion du compte connecté ──────────────────────────────────────────────

async function checkPassword(userId: string, password: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(password, user.passwordHash))) throw new HttpError(403, "wrong_password", "Mot de passe actuel incorrect.");
  return user;
}

/** Nouveau mot de passe : vérifie l'actuel, déconnecte les autres appareils, prévient par email. */
export async function changePassword(userId: string, currentToken: string | undefined, raw: unknown) {
  const input = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) }).parse(raw);
  const user = await checkPassword(userId, input.currentPassword);
  const weak = validatePasswordStrength(input.newPassword);
  if (weak) throw badRequest(weak);
  if (input.newPassword === input.currentPassword) throw badRequest("Le nouveau mot de passe doit être différent de l'actuel.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.newPassword) } }),
    prisma.session.deleteMany({ where: { userId, ...(currentToken ? { id: { not: sha256(currentToken) } } : {}) } }),
  ]);
  await sendMail({
    to: user.email,
    subject: "CoachGG — mot de passe modifié",
    text: "Le mot de passe de ton compte CoachGG vient d'être modifié. Si ce n'est pas toi, utilise « Mot de passe oublié » tout de suite.",
  });
}

/** Nouvelle adresse email : confirmée par le mot de passe ; l'ancienne adresse est prévenue. */
export async function changeEmail(userId: string, raw: unknown) {
  const input = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) }).parse(raw);
  const user = await checkPassword(userId, input.password);
  if (input.email === user.email) throw badRequest("C'est déjà l'adresse de ton compte.");
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw new HttpError(409, "email_taken", "Un compte existe déjà avec cet email.");
  await prisma.user.update({ where: { id: userId }, data: { email: input.email } });
  await sendMail({
    to: user.email,
    subject: "CoachGG — adresse email modifiée",
    text: `L'adresse de ton compte CoachGG a été remplacée par ${input.email}. Si ce n'est pas toi, réponds à ce message ou contacte le support.`,
  });
  return { email: input.email };
}

/** Sessions ouvertes (appareils connectés) et déconnexion des autres. */
export async function countSessions(userId: string) {
  return prisma.session.count({ where: { userId, expiresAt: { gt: new Date() } } });
}
export async function logoutOtherSessions(userId: string, currentToken: string | undefined) {
  const r = await prisma.session.deleteMany({ where: { userId, ...(currentToken ? { id: { not: sha256(currentToken) } } : {}) } });
  return { closed: r.count };
}
