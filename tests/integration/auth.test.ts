import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { login, register, requestPasswordReset, resetPassword } from "@/server/auth/service";
import { userFromToken } from "@/server/auth/session";

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
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await requestPasswordReset("a@test.dev");
    const token = String(log.mock.calls.at(-1)?.[0]).match(/token=([\w-]+)/)?.[1];
    log.mockRestore();
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
