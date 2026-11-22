import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { login, register, requestPasswordReset, resetPassword } from "@/server/auth/service";
import { userFromToken } from "@/server/auth/session";
import { devOutbox } from "@/server/mailer";

describe("authentification", () => {
  it("inscrit, crée un profil par défaut privé et ouvre une session", async () => {
    const { user, session } = await register({ email: "Alice@Test.dev", password: "motdepasse123", displayName: "Alice" });
    expect(user.email).toBe("alice@test.dev");
    expect(user.passwordHash).not.toContain("motdepasse123");
    const profile = await prisma.playerProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.defaultVideoPrivate).toBe(true);
    expect((await userFromToken(session.token))?.id).toBe(user.id);
    // le jeton brut n'est pas stocké
    expect(await prisma.session.count({ where: { id: session.token } })).toBe(0);
  });

  it("refuse un mot de passe faible et un email déjà utilisé", async () => {
    await expect(register({ email: "a@test.dev", password: "court", displayName: "A" })).rejects.toThrow();
    await register({ email: "a@test.dev", password: "motdepasse123", displayName: "Alice" });
    await expect(register({ email: "a@test.dev", password: "motdepasse123", displayName: "Alice" })).rejects.toMatchObject({ status: 409 });
  });

  it("connecte avec le bon mot de passe uniquement", async () => {
    await register({ email: "a@test.dev", password: "motdepasse123", displayName: "Alice" });
    await expect(login({ email: "a@test.dev", password: "mauvais-mdp" })).rejects.toMatchObject({ status: 401 });
    await expect(login({ email: "inconnu@test.dev", password: "x" })).rejects.toMatchObject({ status: 401 });
    expect((await login({ email: "a@test.dev", password: "motdepasse123" })).user.email).toBe("a@test.dev");
  });

  it("réinitialise le mot de passe via un jeton à usage unique et ferme les sessions", async () => {
    const { session } = await register({ email: "a@test.dev", password: "motdepasse123", displayName: "Alice" });
    devOutbox.length = 0;
    await requestPasswordReset("a@test.dev");
    const token = devOutbox.at(-1)?.text.match(/token=([\w-]+)/)?.[1];
    expect(token).toBeTruthy();
    await resetPassword({ token, password: "nouveau-mdp-123" });
    expect(await userFromToken(session.token)).toBeNull();
    await expect(resetPassword({ token, password: "encore-un-mdp" })).rejects.toThrow(/invalide/);
    expect((await login({ email: "a@test.dev", password: "nouveau-mdp-123" })).user).toBeTruthy();
  });

  it("ne révèle pas l'existence d'un compte lors de la récupération", async () => {
    await expect(requestPasswordReset("personne@test.dev")).resolves.toBeUndefined();
  });
});

describe("gestion du compte connecté", async () => {
  const { changePassword, changeEmail, logoutOtherSessions, countSessions } = await import("@/server/auth/service");
  const uniq = () => Math.random().toString(36).slice(2, 8);

  it("changer le mot de passe : exige l'actuel, garde cette session, ferme les autres, prévient par email", async () => {
    const email = `pw-${uniq()}@test.dev`;
    const { user, session } = await register({ email, password: "ancien-motdepasse", displayName: "Pw" });
    const other = await login({ email, password: "ancien-motdepasse" });
    await expect(changePassword(user.id, session.token, { currentPassword: "faux-motdepasse", newPassword: "nouveau-motdepasse" })).rejects.toMatchObject({ status: 403 });
    await expect(changePassword(user.id, session.token, { currentPassword: "ancien-motdepasse", newPassword: "court" })).rejects.toMatchObject({ status: 400 });
    await changePassword(user.id, session.token, { currentPassword: "ancien-motdepasse", newPassword: "nouveau-motdepasse" });
    expect(await userFromToken(session.token)).not.toBeNull();
    expect(await userFromToken(other.session.token)).toBeNull();
    await expect(login({ email, password: "ancien-motdepasse" })).rejects.toMatchObject({ status: 401 });
    expect((await login({ email, password: "nouveau-motdepasse" })).user.id).toBe(user.id);
    expect(devOutbox.some((m) => m.to === email && /mot de passe modifié/.test(m.subject))).toBe(true);
  });

  it("changer l'email : mot de passe requis, adresse libre, ancienne adresse prévenue", async () => {
    const email = `em-${uniq()}@test.dev`;
    const taken = `taken-${uniq()}@test.dev`;
    await register({ email: taken, password: "motdepasse-long", displayName: "Taken" });
    const { user } = await register({ email, password: "motdepasse-long", displayName: "Em" });
    await expect(changeEmail(user.id, { email: `x-${uniq()}@test.dev`, password: "mauvais" })).rejects.toMatchObject({ status: 403 });
    await expect(changeEmail(user.id, { email: taken, password: "motdepasse-long" })).rejects.toMatchObject({ status: 409 });
    const next = `New-${uniq()}@Test.dev`;
    await changeEmail(user.id, { email: next, password: "motdepasse-long" });
    expect((await login({ email: next, password: "motdepasse-long" })).user.id).toBe(user.id);
    expect(devOutbox.some((m) => m.to === email && /adresse email modifiée/.test(m.subject))).toBe(true);
  });

  it("déconnecter les autres appareils", async () => {
    const email = `se-${uniq()}@test.dev`;
    const { user, session } = await register({ email, password: "motdepasse-long", displayName: "Se" });
    await login({ email, password: "motdepasse-long" });
    await login({ email, password: "motdepasse-long" });
    expect(await countSessions(user.id)).toBe(3);
    expect((await logoutOtherSessions(user.id, session.token)).closed).toBe(2);
    expect(await userFromToken(session.token)).not.toBeNull();
    expect(await countSessions(user.id)).toBe(1);
  });
});
