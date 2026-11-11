// Amis via Riot ID : demande, réponse générique, acceptation croisée, classement, badges.
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createManualMatch } from "@/server/matches/service";
import { friendsLeaderboard, listFriends, pendingFriendRequests, removeFriend, respondFriendRequest, sendFriendRequest } from "@/server/friends";
import { makeUser } from "./helpers";

async function player(name: string, riot: string) {
  const u = await makeUser(name);
  await prisma.gameIdentity.create({ data: { userId: u.id, gameName: riot, tagLine: "EUW", platform: "EUW1" } });
  return u;
}

async function wins(userId: string, riot: string, n: number, win = true) {
  for (let i = 0; i < n; i++)
    await createManualMatch(userId, {
      durationSec: 1800,
      gameMode: "NORMAL",
      gameStartAt: new Date(Date.now() - (i + 1) * 3600_000),
      participants: [{ isMe: true, riotGameName: riot, riotTagLine: "EUW", championName: "Ahri", role: "MIDDLE", teamSide: 100, win, kills: 8, deaths: 0, assists: 9, creepScore: 230, visionScore: 30, damageToChampions: 25000, goldEarned: 12000 }],
    });
}

describe("amis via Riot ID", () => {
  it("demande → acceptation → carte d'ami (forme, série, badges) ; réponse identique avec ou sans compte", async () => {
    const ana = await player("Ana", "AnaGG");
    const bob = await player("Bob", "BobGG");
    const withAccount = await sendFriendRequest(ana.id, { riotId: "bobgg#euw" });
    const withoutAccount = await sendFriendRequest(ana.id, { riotId: "Inconnu#EUW" });
    expect(withAccount.message).toBe(withoutAccount.message); // ne révèle pas l'existence d'un compte
    expect(await prisma.teammate.count({ where: { ownerId: ana.id } })).toBe(2); // tous deux suivis
    await expect(sendFriendRequest(ana.id, { riotId: "AnaGG#EUW" })).rejects.toMatchObject({ status: 400 });
    await sendFriendRequest(ana.id, { riotId: "BobGG#EUW" }); // pas de doublon
    expect(await prisma.friendship.count()).toBe(1);
    expect(await prisma.notification.count({ where: { userId: bob.id, type: "friend_request" } })).toBe(1);

    const [req] = await pendingFriendRequests(bob.id);
    await expect(respondFriendRequest(ana.id, req!.id, true)).rejects.toMatchObject({ status: 404 }); // pas sa demande
    await respondFriendRequest(bob.id, req!.id, true);
    await wins(bob.id, "BobGG", 3);
    const [card] = await listFriends(ana.id);
    expect(card).toMatchObject({ displayName: "Bob", riotId: "BobGG#EUW", form: ["V", "V", "V"], streak: { kind: "V", n: 3 } });
    expect(card!.badges.map((b) => b.key)).toEqual(expect.arrayContaining(["ON_FIRE", "UNTOUCHABLE"]));
    expect((await listFriends(bob.id))[0]!.displayName).toBe("Ana"); // amitié réciproque

    await removeFriend(ana.id, card!.friendshipId);
    expect(await listFriends(bob.id)).toEqual([]);
  });

  it("demande croisée = amis directement ; un refus ne relance pas", async () => {
    const ana = await player("Ana", "AnaGG");
    const bob = await player("Bob", "BobGG");
    const cy = await player("Cy", "CyGG");
    await sendFriendRequest(ana.id, { riotId: "BobGG#EUW" });
    await sendFriendRequest(bob.id, { riotId: "AnaGG#EUW" });
    expect((await listFriends(ana.id)).map((f) => f.displayName)).toEqual(["Bob"]);

    await sendFriendRequest(ana.id, { riotId: "CyGG#EUW" });
    const [req] = await pendingFriendRequests(cy.id);
    await respondFriendRequest(cy.id, req!.id, false);
    await sendFriendRequest(ana.id, { riotId: "CyGG#EUW" });
    expect(await pendingFriendRequests(cy.id)).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: cy.id, type: "friend_request" } })).toBe(1);
    // Cy change d'avis : nouvelle demande dans l'autre sens
    await sendFriendRequest(cy.id, { riotId: "AnaGG#EUW" });
    expect(await pendingFriendRequests(ana.id)).toHaveLength(1);
  });

  it("classement de la semaine entre amis (3 parties minimum pour la note)", async () => {
    const ana = await player("Ana", "AnaGG");
    const bob = await player("Bob", "BobGG");
    await sendFriendRequest(ana.id, { riotId: "BobGG#EUW" });
    await sendFriendRequest(bob.id, { riotId: "AnaGG#EUW" });
    await wins(ana.id, "AnaGG", 2);
    await wins(bob.id, "BobGG", 4);
    const byScore = await friendsLeaderboard(ana.id, "score");
    expect(byScore.map((c) => [c.displayName, c.me])).toEqual([["Bob", false], ["Ana", true]]);
    expect(byScore[1]!.value).toBe(-1); // Ana : 2 parties, non classée sur la note
    const byWins = await friendsLeaderboard(ana.id, "wins");
    expect(byWins.map((c) => c.value)).toEqual([4, 2]);
  });
});
