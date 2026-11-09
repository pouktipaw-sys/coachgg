// Intégration Riot avec un serveur simulé (aucun appel réseau réel).
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { RiotApiError, RiotClient, convertRiotMatch, participantTimeline, regionalRoute, type RiotMatch, type RiotTimeline } from "@/server/riot/client";
import { importRecentMatches, refreshRank } from "@/server/riot/import";
import { makeUser } from "./helpers";

function fakeMatch(id: string, puuids: string[]): RiotMatch {
  return {
    metadata: { matchId: id },
    info: {
      gameCreation: 1_760_000_000_000,
      gameStartTimestamp: 1_760_000_000_000,
      gameDuration: 1800,
      gameEndTimestamp: 1_760_001_800_000,
      gameVersion: "15.20.1",
      queueId: 420,
      platformId: "EUW1",
      participants: Array.from({ length: 10 }, (_, i) => ({
        puuid: puuids[i] ?? `p${i}`,
        riotIdGameName: `Player${i}`,
        riotIdTagline: "EUW",
        championName: `Champ${i}`,
        teamPosition: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][i % 5],
        teamId: i < 5 ? 100 : 200,
        win: i < 5,
        kills: 5,
        deaths: 4,
        assists: 6,
        totalMinionsKilled: 180,
        neutralMinionsKilled: 20,
        goldEarned: 11000,
        totalDamageDealtToChampions: 18000,
        damageDealtToObjectives: 6000,
        visionScore: 22,
        wardsPlaced: 10,
        wardsKilled: 3,
        visionWardsBoughtInGame: 2,
        item0: 3031,
        item1: 0,
      })),
    },
  };
}

function fakeFetch(routes: Record<string, unknown>, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("{}", { status: 404 });
    const v = routes[key];
    if (v instanceof Response) return v;
    return new Response(JSON.stringify(v), { status: 200 });
  };
}

describe("intégration Riot (simulée)", () => {
  it("route les régions correctement", () => {
    expect(regionalRoute("EUW1")).toBe("europe");
    expect(regionalRoute("NA1")).toBe("americas");
    expect(regionalRoute("KR")).toBe("asia");
    expect(regionalRoute("OC1")).toBe("sea");
  });

  it("convertit un match MATCH-V5 (CS = sbires + monstres, totaux d'équipe, file)", () => {
    const m = convertRiotMatch(fakeMatch("EUW1_1", []));
    expect(m.gameMode).toBe("RANKED_SOLO");
    expect(m.durationSec).toBe(1800);
    expect(m.participants[0]!.stats.creepScore).toBe(200);
    expect(m.participants[0]!.stats.items).toEqual([3031]);
    expect(m.teamStats["100"]!.kills).toBe(25);
  });

  it("traduit les erreurs (clé expirée) sans planter", async () => {
    const c = new RiotClient("k", fakeFetch({ "/riot/account": new Response("{}", { status: 403 }) }));
    await expect(c.accountByRiotId("a", "b", "EUW1")).rejects.toBeInstanceOf(RiotApiError);
    await expect(c.accountByRiotId("a", "b", "EUW1")).rejects.toThrow(/expirée/);
  });

  it("importe les matchs, lie l'utilisateur par PUUID, calcule les notes, et reste idempotent", async () => {
    const u = await makeUser("Ana");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Ana", tagLine: "EUW", platform: "EUW1" } });
    const calls: string[] = [];
    const client = new RiotClient(
      "k",
      fakeFetch(
        {
          "/riot/account/v1/accounts/by-riot-id/Ana/EUW": { puuid: "PUUID-ANA", gameName: "Ana", tagLine: "EUW" },
          "/ids?": ["EUW1_1", "EUW1_2"],
          "/matches/EUW1_1": fakeMatch("EUW1_1", ["PUUID-ANA"]),
          "/matches/EUW1_2": fakeMatch("EUW1_2", ["x", "y", "PUUID-ANA"]),
        },
        calls,
      ),
    );
    const r = await importRecentMatches(u.id, 2, client);
    expect(r.map((x) => x.status)).toEqual(["imported", "imported"]);
    expect(calls.every((c) => c.startsWith("https://europe.api.riotgames.com/"))).toBe(true);
    const mine = await prisma.matchParticipant.findMany({ where: { userId: u.id }, include: { scores: true } });
    expect(mine).toHaveLength(2);
    expect(mine.every((p) => p.scores[0]?.overall != null)).toBe(true);
    const again = await importRecentMatches(u.id, 2, client);
    expect(again.map((x) => x.status)).toEqual(["already", "already"]);
    expect(await prisma.match.count()).toBe(2);
  });

  it("l'échec de l'API Riot n'affecte pas les données existantes", async () => {
    const u = await makeUser("Ana");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Ana", tagLine: "EUW", platform: "EUW1", puuid: "P" } });
    const client = new RiotClient("k", async () => {
      throw new Error("down");
    });
    await expect(importRecentMatches(u.id, 2, client)).rejects.toThrow(/injoignable/);
  });
  it("stocke l'évolution minute par minute (or, CS, achats) issue de la timeline", async () => {
    const u = await makeUser("Ana");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Ana", tagLine: "EUW", platform: "EUW1", puuid: "PUUID-ANA" } });
    const puuids = ["PUUID-ANA", ...Array.from({ length: 9 }, (_, i) => `p${i + 1}`)];
    const tl: RiotTimeline = {
      metadata: { matchId: "EUW1_9", participants: puuids },
      info: {
        frames: [0, 1, 2].map((m) => ({
          timestamp: m * 60_000,
          events: m === 0 ? [{ type: "ITEM_PURCHASED", timestamp: 1500, participantId: 1, itemId: 1055 }, { type: "ITEM_PURCHASED", timestamp: 1600, participantId: 2, itemId: 1056 }] : [],
          participantFrames: Object.fromEntries(puuids.map((_, i) => [String(i + 1), { totalGold: 500 + m * 400, minionsKilled: m * 7, jungleMinionsKilled: m }])),
        })),
      },
    };
    expect(participantTimeline(tl, "inconnu")).toBeNull();
    const client = new RiotClient(
      "k",
      fakeFetch({ "/EUW1_9/timeline": tl, "/ids?": ["EUW1_9"], "/matches/EUW1_9": fakeMatch("EUW1_9", puuids) }),
    );
    await importRecentMatches(u.id, 1, client);
    const p = await prisma.matchParticipant.findFirst({ where: { userId: u.id }, include: { statistics: true } });
    const t = p!.statistics!.timeline as { gold: number[]; cs: number[]; purchases: { itemId: number }[]; source: string };
    expect(t.source).toBe("riot_timeline");
    expect(t.gold).toEqual([500, 900, 1300]);
    expect(t.cs).toEqual([0, 8, 16]);
    expect(t.purchases.map((x) => x.itemId)).toEqual([1055]);
  });

  it("récupère le rang (LEAGUE-V4) sur l'hôte du serveur de jeu et ignore les files non classées", async () => {
    const u = await makeUser("Ana");
    const id = await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Ana", tagLine: "EUW", platform: "EUW1", puuid: "PUUID-ANA" } });
    const calls: string[] = [];
    const client = new RiotClient(
      "k",
      fakeFetch(
        {
          "/lol/league/v4/entries/by-puuid/PUUID-ANA": [
            { queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "II", leaguePoints: 54, wins: 30, losses: 25 },
            { queueType: "CHERRY", tier: "", rank: "", leaguePoints: 0, wins: 1, losses: 0 },
          ],
        },
        calls,
      ),
    );
    const updated = await refreshRank(u.id, id.id, client);
    expect(calls[0]).toBe("https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/PUUID-ANA");
    expect(updated.rank).toEqual([{ queue: "RANKED_SOLO_5x5", label: "Classée solo/duo", tier: "GOLD", division: "II", lp: 54, wins: 30, losses: 25 }]);
    expect(updated.rankFetchedAt).toBeInstanceOf(Date);
    const other = await makeUser("Bob");
    await expect(refreshRank(other.id, id.id, client)).rejects.toThrow();
  });
});
