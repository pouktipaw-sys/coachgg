import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createManualMatch, deleteMatch, getMatchReport, type ManualMatchInput } from "@/server/matches/service";
import { listUserMatches, parseMatchFilters } from "@/server/matches/queries";
import { createTeam, inviteToTeam, leaveTeam, removeMember, respondInvitation, setMemberRole } from "@/server/teams/service";
import { teamDashboard, teamMatchDetail } from "@/server/teams/dashboard";
import { canViewMatch } from "@/server/permissions";
import { createGoal, goalProgress } from "@/server/goals";
import { deleteAccount, exportUserData } from "@/server/account";
import { hashPassword } from "@/server/auth/password";
import { syncSession } from "@/server/video/sync";
import { register } from "@/server/auth/service";
import { devOutbox } from "@/server/mailer";
import { makeUser } from "./helpers";

type P = ManualMatchInput["participants"][number];
const player = (over: Partial<P>): P => ({
  isMe: false,
  championName: "Ahri",
  role: "MIDDLE",
  teamSide: 100,
  win: true,
  kills: 5,
  deaths: 3,
  assists: 7,
  creepScore: 200,
  goldEarned: 11000,
  damageToChampions: 20000,
  damageToObjectives: 5000,
  visionScore: 25,
  ...over,
});

async function identity(userId: string, gameName: string) {
  await prisma.gameIdentity.create({ data: { userId, gameName, tagLine: "EUW", platform: "EUW1" } });
}

async function friends() {
  const ana = await makeUser("Ana");
  const bob = await makeUser("Bob");
  const cy = await makeUser("Cy");
  await identity(ana.id, "AnaGG");
  await identity(bob.id, "BobGG");
  await identity(cy.id, "CyGG");
  const team = await createTeam(ana.id, { name: "Les potes" });
  for (const u of [bob, cy]) {
    await inviteToTeam(ana.id, team.id, u.email);
    const inv = await prisma.teamInvitation.findFirstOrThrow({ where: { inviteeId: u.id, status: "PENDING" } });
    await respondInvitation(u.id, inv.id, true);
  }
  return { ana, bob, cy, team };
}

const teamMatch = (over: Partial<ManualMatchInput> = {}): ManualMatchInput => ({
  durationSec: 30 * 60,
  gameMode: "NORMAL",
  participants: [
    player({ isMe: true, riotGameName: "AnaGG", riotTagLine: "EUW", role: "MIDDLE", kills: 10, assists: 8, visionScore: 30 }),
    player({ riotGameName: "BobGG", riotTagLine: "EUW", role: "JUNGLE", championName: "Vi", kills: 4, assists: 12, creepScore: 170, visionScore: 40, damageToObjectives: 15000 }),
    player({ riotGameName: "CyGG", riotTagLine: "EUW", role: "BOTTOM", championName: "Jinx", kills: 7, deaths: 6, assists: 5, creepScore: 260 }),
    player({ riotGameName: "Rando", riotTagLine: "EUW", role: "TOP", championName: "Garen" }),
    player({ riotGameName: "Rando2", riotTagLine: "EUW", role: "UTILITY", championName: "Lulu", creepScore: 30, damageToChampions: 7000, visionScore: 70, damageToObjectives: 1000 }),
  ],
  ...over,
});

describe("matchs et notes", () => {
  it("enregistre un match manuel, déduit les totaux d'équipe et calcule une note versionnée", async () => {
    const u = await makeUser("Solo");
    const m = await createManualMatch(u.id, {
      durationSec: 1800,
      gameMode: "RANKED_SOLO",
      participants: [player({ isMe: true })],
      teamTotals: { "100": { kills: 25, damageToChampions: 90000, damageToObjectives: 30000 } },
    });
    const report = await getMatchReport(u.id, m.id);
    const me = report.participants[0]!;
    expect(me.userId).toBe(u.id);
    const s = me.scores[0]!;
    expect(s.scoreVersionId).toBe("perf-1.0.0");
    expect(s.overall).toBeGreaterThan(0);
    expect(s.reliability).toBe("high");
  });

  it("enregistre les champs vides comme non disponibles et le signale", async () => {
    const u = await makeUser("Solo");
    const m = await createManualMatch(u.id, {
      durationSec: 1800,
      gameMode: "NORMAL",
      participants: [player({ isMe: true, visionScore: null, damageToObjectives: null, damageToChampions: null })],
      teamTotals: { "100": { kills: 20 } },
    });
    const stats = await prisma.matchStatistics.findFirstOrThrow({ where: { participant: { matchId: m.id } } });
    expect(stats.visionScore).toBeNull();
    const score = await prisma.performanceScore.findFirstOrThrow({ where: { participant: { matchId: m.id } } });
    expect((score.missingData as { items: string[] }).items.length).toBe(3);
  });

  it("valide la cohérence (un seul « moi », résultats d'équipe)", async () => {
    const u = await makeUser("Solo");
    await expect(createManualMatch(u.id, { durationSec: 1800, gameMode: "NORMAL", participants: [player({})] })).rejects.toThrow();
    await expect(
      createManualMatch(u.id, { durationSec: 1800, gameMode: "NORMAL", participants: [player({ isMe: true }), player({ win: false })] }),
    ).rejects.toThrow();
  });

  it("filtre l'historique par champion, rôle et présence d'amis", async () => {
    const { ana } = await friends();
    await createManualMatch(ana.id, teamMatch());
    await createManualMatch(ana.id, { durationSec: 1500, gameMode: "RANKED_SOLO", participants: [player({ isMe: true, championName: "Lux", role: "UTILITY" })] });
    expect(await listUserMatches(ana.id, parseMatchFilters({}))).toHaveLength(2);
    expect(await listUserMatches(ana.id, parseMatchFilters({ champion: "lux" }))).toHaveLength(1);
    expect(await listUserMatches(ana.id, parseMatchFilters({ role: "MIDDLE" }))).toHaveLength(1);
    expect(await listUserMatches(ana.id, parseMatchFilters({ with: "friends" }))).toHaveLength(1);
    expect(await listUserMatches(ana.id, parseMatchFilters({ with: "solo" }))).toHaveLength(1);
    expect(await listUserMatches(ana.id, parseMatchFilters({ mode: "ARAM" }))).toHaveLength(0);
  });

  it("seul l'auteur supprime un match", async () => {
    const { ana, bob } = await friends();
    const m = await createManualMatch(ana.id, teamMatch());
    await expect(deleteMatch(bob.id, m.id)).rejects.toMatchObject({ status: 403 });
    await deleteMatch(ana.id, m.id);
    expect(await prisma.match.count()).toBe(0);
  });
});

describe("groupes, matchs communs et MVP", () => {
  it("relie les amis du groupe, ignore les inconnus, et calcule le MVP parmi les membres présents", async () => {
    const { ana, bob, cy, team } = await friends();
    const m = await createManualMatch(ana.id, teamMatch());
    const parts = await prisma.matchParticipant.findMany({ where: { matchId: m.id } });
    expect(parts.filter((p) => p.userId).map((p) => p.userId).sort()).toEqual([ana.id, bob.id, cy.id].sort());

    const report = await prisma.teamMatchReport.findFirstOrThrow({ where: { teamId: team.id, matchId: m.id } });
    expect(report.presentUserIds.sort()).toEqual([ana.id, bob.id, cy.id].sort());
    expect(report.mvpUserIds.length).toBeGreaterThanOrEqual(1);
    expect(report.mvpUserIds.every((id) => [ana.id, bob.id, cy.id].includes(id))).toBe(true);

    const detail = await teamMatchDetail(bob.id, team.id, m.id);
    expect(detail!.rows).toHaveLength(3); // pas les 2 joueurs hors groupe
    expect(detail!.explanation.text.length).toBeGreaterThan(10);
    expect(detail!.collective?.basis).toMatch(/vocales/);
  });

  it("ne relie pas un Riot ID déclaré par un utilisateur sans groupe commun", async () => {
    const ana = await makeUser("Ana");
    const stranger = await makeUser("Stranger");
    await identity(stranger.id, "BobGG");
    const m = await createManualMatch(ana.id, teamMatch());
    expect(await prisma.matchParticipant.count({ where: { matchId: m.id, userId: stranger.id } })).toBe(0);
    expect(await canViewMatch(stranger.id, m.id)).toBe(false);
  });

  it("déclare une égalité MVP entre deux membres aux statistiques identiques", async () => {
    const { ana, team } = await friends();
    const same = { kills: 6, deaths: 2, assists: 9, creepScore: 220, damageToChampions: 21000, damageToObjectives: 6000, visionScore: 30, role: "MIDDLE" as const };
    const m = await createManualMatch(ana.id, {
      durationSec: 1800,
      gameMode: "NORMAL",
      participants: [player({ isMe: true, riotGameName: "AnaGG", riotTagLine: "EUW", ...same }), player({ riotGameName: "BobGG", riotTagLine: "EUW", championName: "Syndra", ...same })],
      teamTotals: { "100": { kills: 25, damageToChampions: 95000, damageToObjectives: 30000 } },
    });
    const r = await prisma.teamMatchReport.findFirstOrThrow({ where: { teamId: team.id, matchId: m.id } });
    expect(r.isTie).toBe(true);
    expect(r.mvpUserIds).toHaveLength(2);
  });

  it("n'expose les matchs aux membres que via un groupe commun, et retire l'accès après départ", async () => {
    const { ana, bob, cy, team } = await friends();
    const outsider = await makeUser("Out");
    const m = await createManualMatch(ana.id, { durationSec: 1800, gameMode: "NORMAL", participants: [player({ isMe: true })], teamTotals: { "100": { kills: 20 } } });
    expect(await canViewMatch(bob.id, m.id)).toBe(true); // groupe commun avec Ana
    expect(await canViewMatch(outsider.id, m.id)).toBe(false);
    await leaveTeam(bob.id, team.id);
    expect(await canViewMatch(bob.id, m.id)).toBe(false);
    // statistiques non partagées avec les groupes
    await prisma.playerProfile.update({ where: { userId: ana.id }, data: { shareStatsWithTeams: false } });
    expect(await canViewMatch(cy.id, m.id)).toBe(false);
  });

  it("met à jour les rapports quand un membre est retiré (moins de 2 présents → rapport supprimé)", async () => {
    const { ana, bob, team } = await friends();
    const m = await createManualMatch(ana.id, {
      ...teamMatch(),
      participants: teamMatch().participants.filter((p) => p.riotGameName !== "CyGG"),
    });
    expect(await prisma.teamMatchReport.count({ where: { teamId: team.id, matchId: m.id } })).toBe(1);
    await removeMember(ana.id, team.id, bob.id);
    expect(await prisma.teamMatchReport.count({ where: { teamId: team.id, matchId: m.id } })).toBe(0);
  });

  it("révoque les partages vidéo d'un membre qui quitte le groupe", async () => {
    const { bob, cy, team } = await friends();
    const rec = await prisma.recording.create({
      data: { ownerId: bob.id, title: "x", originalFilename: "x.mp4", declaredMime: "", sizeBytes: 10n, originalKey: "k", status: "READY" },
    });
    await prisma.sharePermission.create({ data: { recordingId: rec.id, grantedById: bob.id, granteeTeamId: team.id } });
    await leaveTeam(bob.id, team.id);
    expect(await prisma.sharePermission.count({ where: { recordingId: rec.id, revokedAt: null } })).toBe(0);
    expect(cy).toBeTruthy();
  });

  it("gère les invitations : réponse générique, refus, rôles et dernier administrateur", async () => {
    const ana = await makeUser("Ana");
    const bob = await makeUser("Bob");
    const team = await createTeam(ana.id, { name: "Gr" });
    const generic = await inviteToTeam(ana.id, team.id, "inconnu@test.dev");
    expect(generic.message).toMatch(/Invitation envoyée/);
    await inviteToTeam(ana.id, team.id, bob.email);
    const inv = await prisma.teamInvitation.findFirstOrThrow({ where: { inviteeId: bob.id } });
    await expect(respondInvitation(ana.id, inv.id, true)).rejects.toMatchObject({ status: 404 }); // pas son invitation
    await respondInvitation(bob.id, inv.id, false);
    expect(await prisma.teamMembership.count({ where: { teamId: team.id } })).toBe(1);
    await expect(inviteToTeam(bob.id, team.id, ana.email)).rejects.toMatchObject({ status: 404 }); // non membre
    await expect(setMemberRole(ana.id, team.id, ana.id, "MEMBER")).rejects.toThrow(/administrateur/);
    // le dernier membre qui quitte supprime le groupe
    expect((await leaveTeam(ana.id, team.id)).deleted).toBe(true);
  });

  it("transmet le rôle d'administrateur quand le dernier admin quitte", async () => {
    const { ana, bob, team } = await friends();
    await leaveTeam(ana.id, team.id);
    const m = await prisma.teamMembership.findMany({ where: { teamId: team.id } });
    expect(m.some((x) => x.role === "ADMIN")).toBe(true);
    expect(m.find((x) => x.userId === bob.id)).toBeTruthy();
  });

  it("produit le tableau de bord du groupe (parties communes, MVP, victoires)", async () => {
    const { ana, bob, team } = await friends();
    await createManualMatch(ana.id, teamMatch());
    await createManualMatch(ana.id, teamMatch({ durationSec: 25 * 60 }));
    const d = await teamDashboard(bob.id, team.id);
    expect(d.stats.commonMatches).toBe(2);
    expect(d.stats.wins).toBe(2);
    expect(d.stats.mvpCount.reduce((a, b) => a + b.n, 0)).toBeGreaterThanOrEqual(2);
  });
});

describe("objectifs, export et suppression", () => {
  it("mesure un objectif sur les parties de la période", async () => {
    const u = await makeUser("Solo");
    const goal = await createGoal(u.id, { title: "Mieux voir", metricKey: "vision", metricTarget: 5, periodDays: 7 });
    await createManualMatch(u.id, { durationSec: 1800, gameMode: "NORMAL", participants: [player({ isMe: true, visionScore: 40 })], teamTotals: { "100": { kills: 20 } } });
    await createManualMatch(u.id, { durationSec: 1800, gameMode: "NORMAL", participants: [player({ isMe: true, visionScore: 3 })], teamTotals: { "100": { kills: 20 } } });
    const p = await goalProgress(goal);
    expect(p).toMatchObject({ matches: 2, met: 1 });
  });

  it("exporte les données et supprime le compte (avec transfert d'administration)", async () => {
    const { ana, bob, team } = await friends();
    await prisma.user.update({ where: { id: ana.id }, data: { passwordHash: await hashPassword("motdepasse123") } });
    const exp = await exportUserData(ana.id);
    expect(exp.user.email).toBe(ana.email);
    expect(JSON.stringify(exp)).not.toContain("passwordHash");
    await expect(deleteAccount(ana.id, "mauvais")).rejects.toMatchObject({ status: 403 });
    await deleteAccount(ana.id, "motdepasse123");
    expect(await prisma.user.findUnique({ where: { id: ana.id } })).toBeNull();
    const admins = await prisma.teamMembership.findMany({ where: { teamId: team.id, role: "ADMIN" } });
    expect(admins).toHaveLength(1);
    expect(bob).toBeTruthy();
  });
  it("visionnage synchronisé : seules les vidéos déjà visibles, groupe ≠ accès aux vidéos privées", async () => {
    const { ana, bob, team } = await friends();
    const m = await createManualMatch(ana.id, teamMatch());
    const rec = (ownerId: string, extra: object) =>
      prisma.recording.create({
        data: { ownerId, matchId: m.id, title: "v", originalFilename: "v.mp4", declaredMime: "", sizeBytes: 10n, originalKey: "k", playbackKey: "p", status: "READY", durationMs: 600_000, ...extra },
      });
    await rec(ana.id, { title: "Ana synchro", gameStartOffsetMs: 20_000 });
    await rec(ana.id, { title: "Ana brute" });
    const bobRec = await rec(bob.id, { title: "Bob synchro", gameStartOffsetMs: -60_000 });
    await rec(ana.id, { title: "En cours", status: "PROCESSING", gameStartOffsetMs: 0 });

    let s = await syncSession(ana.id, m.id);
    expect(s.tracks.map((t) => t.title)).toEqual(["Ana synchro"]); // la vidéo privée de Bob n'apparaît pas
    expect(s.unsynced.map((t) => t.title)).toEqual(["Ana brute"]);

    await prisma.sharePermission.create({ data: { recordingId: bobRec.id, grantedById: bob.id, granteeTeamId: team.id } });
    s = await syncSession(ana.id, m.id);
    expect(s.tracks.map((t) => [t.title, t.mine, t.gameStartOffsetMs])).toEqual([
      ["Ana synchro", true, 20_000],
      ["Bob synchro", false, -60_000],
    ]);

    const outsider = await makeUser("Zed");
    await expect(syncSession(outsider.id, m.id)).rejects.toMatchObject({ status: 404 });
  });
  it("invite par email une personne sans compte : lien à usage unique, adresse vérifiée par le jeton", async () => {
    const ana = await makeUser("Ana");
    const team = await createTeam(ana.id, { name: "Duo" });
    devOutbox.length = 0;
    const r = await inviteToTeam(ana.id, team.id, "Nouveau@Test.dev");
    expect(r.message).toMatch(/Invitation envoyée/);
    await inviteToTeam(ana.id, team.id, "nouveau@test.dev"); // pas de doublon
    expect(devOutbox).toHaveLength(1);
    expect(devOutbox[0]!.to).toBe("nouveau@test.dev");
    expect(devOutbox[0]!.text).not.toMatch(/mot de passe Riot.*demand/i);
    const token = /invite=([\w-]+)/.exec(devOutbox[0]!.text)![1]!;
    // le jeton est stocké haché, jamais en clair
    expect(await prisma.teamEmailInvite.count({ where: { id: token } })).toBe(0);

    // une autre adresse ne peut pas utiliser le jeton
    const other = await register({ email: "autre@test.dev", password: "Motdepasse-solide-1", displayName: "Autre", inviteToken: token });
    expect(other.teamInvitation).toBeNull();

    const joined = await register({ email: "nouveau@test.dev", password: "Motdepasse-solide-1", displayName: "Nouveau", inviteToken: token });
    expect(joined.teamInvitation).not.toBeNull();
    // invitation normale : rien n'est accepté automatiquement
    expect(await prisma.teamMembership.count({ where: { teamId: team.id, userId: joined.user.id } })).toBe(0);
    await respondInvitation(joined.user.id, joined.teamInvitation!.id, true);
    expect(await prisma.teamMembership.count({ where: { teamId: team.id } })).toBe(2);
    expect((await prisma.teamEmailInvite.findFirstOrThrow({ where: { email: "nouveau@test.dev" } })).consumedAt).not.toBeNull();
  });

  it("envoie aussi un email aux comptes existants invités", async () => {
    const ana = await makeUser("Ana");
    const bob = await makeUser("Bob");
    const team = await createTeam(ana.id, { name: "Duo" });
    devOutbox.length = 0;
    await inviteToTeam(ana.id, team.id, bob.email);
    expect(devOutbox.map((m) => m.to)).toEqual([bob.email]);
    expect(devOutbox[0]!.text).toMatch(/\/app\/invitations/);
    expect(await prisma.teamEmailInvite.count()).toBe(0);
  });
});
