// Coéquipiers suivis par Riot ID et votes après partie (MVP élu, catégories, droits).
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createManualMatch, type ManualMatchInput } from "@/server/matches/service";
import { listUserMatches, parseMatchFilters } from "@/server/matches/queries";
import { submitBallot, voteBoard } from "@/server/peerVotes";
import { addTeammate, listTeammates, removeTeammate } from "@/server/teammates";
import { makeUser } from "./helpers";

type P = ManualMatchInput["participants"][number];
const pl = (over: Partial<P>): P => ({ isMe: false, championName: "Ahri", role: "MIDDLE", teamSide: 100, win: true, kills: 5, deaths: 3, assists: 7, ...over });

async function setup() {
  const [ana, bob, cy] = await Promise.all([makeUser("Ana"), makeUser("Bob"), makeUser("Cy")]);
  for (const [u, n] of [[ana, "AnaGG"], [bob, "BobGG"], [cy, "CyGG"]] as const)
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: n, tagLine: "EUW", platform: "EUW1" } });
  const match = await createManualMatch(ana.id, {
    durationSec: 1800,
    gameMode: "NORMAL",
    participants: [
      pl({ isMe: true, riotGameName: "AnaGG", riotTagLine: "EUW" }),
      pl({ riotGameName: "BobGG", riotTagLine: "EUW", championName: "Vi", role: "JUNGLE" }),
      pl({ riotGameName: "CyGG", riotTagLine: "EUW", championName: "Jinx", role: "BOTTOM" }),
      pl({ riotGameName: "Rando", riotTagLine: "EUW", championName: "Garen", role: "TOP" }),
      pl({ riotGameName: "Enemy", riotTagLine: "EUW", championName: "Zed", teamSide: 200, win: false }),
    ],
  });
  // Bob et Cy liés à leur compte (comme lors d'un import Riot par PUUID).
  for (const [u, n] of [[bob, "BobGG"], [cy, "CyGG"]] as const)
    await prisma.matchParticipant.updateMany({ where: { matchId: match.id, riotGameName: n }, data: { userId: u.id } });
  const parts = await prisma.matchParticipant.findMany({ where: { matchId: match.id } });
  const id = (n: string) => parts.find((p) => p.riotGameName === n)!.id;
  return { ana, bob, cy, match, id };
}

describe("votes entre coéquipiers", () => {
  it("chaque joueur note ses coéquipiers ; MVP élu à la majorité ; catégories ; notification", async () => {
    const { ana, bob, cy, match, id } = await setup();
    const board = await voteBoard(ana.id, match.id);
    expect(board.mates.map((m) => m.name).sort()).toEqual(["Bob", "Cy", "Rando#EUW"]); // pas l'adversaire, pas soi-même

    await submitBallot(ana.id, match.id, { votes: [{ targetId: id("BobGG"), score: 9, mvp: true, awards: ["CARRY"] }, { targetId: id("CyGG"), score: 7, awards: ["VISION"] }] });
    expect(await prisma.notification.count({ where: { type: "peer_vote", userId: { in: [bob.id, cy.id] } } })).toBe(2);
    await submitBallot(bob.id, match.id, { votes: [{ targetId: id("AnaGG"), score: 8, mvp: true }, { targetId: id("CyGG"), score: 6 }] });
    const final = await submitBallot(cy.id, match.id, { votes: [{ targetId: id("AnaGG"), score: 9, mvp: true, awards: ["SHOTCALL"] }] });
    const blue = final.results.find((r) => r.side === 100)!.tally;
    expect(blue.mvp).toEqual({ targetId: id("AnaGG"), votes: 2 });
    expect(blue.perTarget[id("AnaGG")]!.avgScore).toBe(8.5);
    expect(blue.awards).toEqual({ CARRY: id("BobGG"), VISION: id("CyGG"), SHOTCALL: id("AnaGG") });
    expect(blue.voters).toBe(3);

    // Revoter remplace le bulletin précédent
    await submitBallot(ana.id, match.id, { votes: [{ targetId: id("BobGG"), score: 5 }] });
    expect(await prisma.peerVote.count({ where: { matchId: match.id, voterId: ana.id } })).toBe(1);
  });

  it("refuse les votes interdits", async () => {
    const { ana, match, id } = await setup();
    await expect(submitBallot(ana.id, match.id, { votes: [{ targetId: id("Enemy"), score: 3 }] })).rejects.toMatchObject({ status: 400 });
    await expect(submitBallot(ana.id, match.id, { votes: [{ targetId: id("AnaGG"), score: 10, mvp: true }] })).rejects.toMatchObject({ status: 400 });
    await expect(
      submitBallot(ana.id, match.id, { votes: [{ targetId: id("BobGG"), score: 8, mvp: true }, { targetId: id("CyGG"), score: 8, mvp: true }] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(submitBallot(ana.id, match.id, { votes: [{ targetId: id("BobGG"), score: 11 }] })).rejects.toThrow();
    const zed = await makeUser("Zed");
    await expect(submitBallot(zed.id, match.id, { votes: [] })).rejects.toMatchObject({ status: 403 });
    await expect(voteBoard(zed.id, match.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("coéquipiers suivis", () => {
  it("ajout par Riot ID, parties communes (même équipe), notes reçues, filtre de l'historique", async () => {
    const { ana, match, id } = await setup();
    await submitBallot(ana.id, match.id, { votes: [{ targetId: id("BobGG"), score: 9, mvp: true, awards: ["CARRY"] }] });
    const bobT = await addTeammate(ana.id, { riotId: "bobgg#euw", nickname: "Bobby" });
    await addTeammate(ana.id, { riotId: "Enemy#EUW" });
    await expect(addTeammate(ana.id, { riotId: "BobGG#EUW" })).rejects.toMatchObject({ status: 409 });
    await expect(addTeammate(ana.id, { riotId: "AnaGG#EUW" })).rejects.toMatchObject({ status: 400 });
    await expect(addTeammate(ana.id, { riotId: "sans-tag" })).rejects.toThrow();

    const list = await listTeammates(ana.id);
    const bob = list.find((m) => m.nickname === "Bobby")!;
    expect(bob).toMatchObject({ games: 1, wins: 1, avgScore: 9, myAvgScore: 9, mvpVotes: 1, awards: { CARRY: 1 } });
    expect(list.find((m) => m.riotId === "Enemy#EUW")!.games).toBe(0); // adversaire : pas « ensemble »

    expect(await listUserMatches(ana.id, parseMatchFilters({ mate: bobT.id }))).toHaveLength(1);
    await removeTeammate(ana.id, bobT.id);
    expect(await prisma.teammate.count({ where: { ownerId: ana.id } })).toBe(1);
  });
});
