// Exploration Riot (serveur Riot simulé) : recherche de joueur avec cache des parties, partie en cours,
// runes stockées à l'import, adversaire de voie et builds sur les parties de l'utilisateur.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { RiotClient, type RiotMatch } from "@/server/riot/client";
import { setDdragonFetcher } from "@/server/riot/ddragon";
import { liveGame, lookupPlayer, userGames } from "@/server/riot/explorer";
import { importRecentMatches } from "@/server/riot/import";
import { makeUser } from "./helpers";

const puuids = ["SCOUT", ...Array.from({ length: 9 }, (_, i) => `Q${i + 2}`)];
const champs = ["Ahri", "Vi", "Garen", "Jinx", "Lulu", "Zed", "LeeSin", "Darius", "Kaisa", "Nami"];
const roles = ["MIDDLE", "JUNGLE", "TOP", "BOTTOM", "UTILITY"];
const game = (id: string, win: boolean, me = "SCOUT"): RiotMatch => ({
  metadata: { matchId: id },
  info: {
    gameCreation: 1_760_000_000_000, gameStartTimestamp: 1_760_000_000_000, gameDuration: 1800, gameEndTimestamp: 1_760_001_800_000,
    gameVersion: "15.20.1", queueId: 420, platformId: "EUW1",
    participants: puuids.map((p, i) => ({
      puuid: p === "SCOUT" ? me : p, riotIdGameName: i === 0 ? "Scout" : `P${i}`, riotIdTagline: "EUW", championName: champs[i]!, championId: 100 + i,
      teamPosition: roles[i % 5], teamId: i < 5 ? 100 : 200, win: i < 5 ? win : !win, kills: i === 0 ? 8 : 3, deaths: i === 0 ? 2 : 4, assists: 6,
      totalMinionsKilled: 210, neutralMinionsKilled: 0, goldEarned: 12000, totalDamageDealtToChampions: 20000, damageDealtToObjectives: 4000, visionScore: 20,
      item0: 3089, item1: 3020, item2: 1058,
      perks: { styles: [{ style: 8100, selections: [{ perk: 8112 }] }, { style: 8000, selections: [{ perk: 9111 }] }] },
    })),
  },
});

function fakeRiot(counter: { match: number }, opts: { inGame?: boolean } = {}) {
  return new RiotClient("k", async (url: string) => {
    const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
    if (url.includes("/accounts/by-riot-id/")) return url.includes("Inconnu") ? j({}, 404) : j({ puuid: "SCOUT", gameName: "Scout", tagLine: "EUW" });
    if (url.includes("/league/v4/entries/by-puuid/")) return j([{ queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "II", leaguePoints: 40, wins: 30, losses: 25 }]);
    if (url.includes("/ids?")) return j(["EUW1_1", "EUW1_2", "EUW1_3"]);
    if (url.includes("/top?")) return j([{ championId: 103, championLevel: 7, championPoints: 250000 }]);
    if (url.includes("/by-champion/")) return j({ championId: 100, championLevel: 5, championPoints: 42000 });
    if (url.includes("/active-games/")) return opts.inGame
      ? j({ gameId: 1, gameMode: "CLASSIC", gameQueueConfigId: 420, gameStartTime: Date.now() - 300_000, gameLength: 300, platformId: "EUW1",
          participants: puuids.map((p, i) => ({ puuid: p, riotId: `${i === 0 ? "Scout" : `P${i}`}#EUW`, championId: 100 + i, teamId: i < 5 ? 100 : 200, spell1Id: 4, spell2Id: 14 })),
          bannedChampions: [{ championId: 108, teamId: 200, pickTurn: 1 }] })
      : j({}, 404);
    const m = /\/matches\/(EUW1_\d)$/.exec(url);
    if (m) {
      counter.match++;
      return j(game(m[1]!, m[1] !== "EUW1_3"));
    }
    return j({}, 404);
  });
}

beforeAll(() => {
  // Données du jeu simulées (pas de réseau pendant les tests)
  setDdragonFetcher(async (url) => {
    const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (url.endsWith("versions.json")) return j(["15.20.1"]);
    if (url.endsWith("/champion.json"))
      return j({ data: Object.fromEntries(champs.map((c, i) => [c, { id: c, key: String(100 + i), name: c === "Kaisa" ? "Kai'Sa" : c === "LeeSin" ? "Lee Sin" : c, title: "", tags: [], blurb: "", image: { full: `${c}.png` } }])) });
    if (url.endsWith("/summoner.json")) return j({ data: { SummonerFlash: { key: "4", name: "Saut éclair", image: { full: "SummonerFlash.png" } }, SummonerDot: { key: "14", name: "Embrasement", image: { full: "SummonerDot.png" } } } });
    return new Response("{}", { status: 404 });
  });
});
afterAll(() => setDdragonFetcher(null));

describe("exploration Riot", () => {
  it("recherche de joueur : rang, résumé, champions, parties ; parties mises en cache", async () => {
    await prisma.riotMatchCache.deleteMany({ where: { riotMatchId: { in: ["EUW1_1", "EUW1_2", "EUW1_3"] } } });
    const counter = { match: 0 };
    const r = (await lookupPlayer("Scout#EUW", "euw1", { client: fakeRiot(counter) }))!;
    expect(r.ranks[0]).toMatchObject({ label: "Classée solo/duo", tier: "GOLD", division: "II", lp: 40 });
    expect(r.summary).toMatchObject({ games: 3, wins: 2, winrate: 67, kda: 7, csMin: 7 });
    expect(r.champions[0]).toMatchObject({ name: "Ahri", games: 3 });
    expect(r.games[0]).toMatchObject({ opponent: "Zed", kp: 70 }); // (8 + 6) / 20 éliminations de l'équipe
    expect(r.masteries[0]).toMatchObject({ champion: "Jinx", level: 7 });
    expect(counter.match).toBe(3);
    await lookupPlayer("Scout#EUW", "EUW1", { client: fakeRiot(counter) });
    expect(counter.match).toBe(3); // aucune partie redemandée à Riot
  });

  it("erreurs claires : Riot ID mal écrit, joueur introuvable, serveur inconnu", async () => {
    const c = { match: 0 };
    await expect(lookupPlayer("sans-tag", "EUW1", { client: fakeRiot(c) })).rejects.toMatchObject({ status: 400 });
    await expect(lookupPlayer("Inconnu#EUW", "EUW1", { client: fakeRiot(c) })).rejects.toMatchObject({ status: 404, message: expect.stringMatching(/introuvable/) });
    await expect(lookupPlayer("Scout#EUW", "XX9", { client: fakeRiot(c) })).rejects.toMatchObject({ status: 400 });
  });

  it("partie en cours : 10 joueurs, sorts, rang, maîtrise, bannis ; null hors partie", async () => {
    const c = { match: 0 };
    const off = await liveGame("Scout#EUW", "EUW1", { client: fakeRiot(c) });
    expect(off?.game).toBeNull();
    const on = (await liveGame("Scout#EUW", "EUW1", { client: fakeRiot(c, { inGame: true }) }))!;
    expect(on.game!.teams.map((t) => t.players.length)).toEqual([5, 5]);
    const me = on.game!.teams[0]!.players.find((p) => p.isMe)!;
    expect(me).toMatchObject({ champion: "Ahri", rank: { tier: "GOLD" }, winrate: 55, mastery: { level: 5 } });
    expect(me.spells.map((s) => s.name)).toEqual(["Saut éclair", "Embrasement"]);
    expect(on.game!.teams[1]!.bans).toEqual(["Kai'Sa"]);
  });

  it("parties de l'utilisateur : runes stockées à l'import, adversaire de voie, objets", async () => {
    const u = await makeUser("Ana");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Scout", tagLine: "EUW", platform: "EUW1", puuid: "ME2" } });
    const client = new RiotClient("k", async (url: string) => {
      const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
      if (url.includes("/ids?")) return j(["EUW1_9"]);
      if (url.includes("/matches/EUW1_9/timeline")) return new Response("{}", { status: 404 });
      if (url.includes("/matches/EUW1_9")) return j(game("EUW1_9", true, "ME2"));
      return new Response("{}", { status: 404 });
    });
    await importRecentMatches(u.id, 1, client);
    const [row] = await userGames([u.id]);
    expect(row).toMatchObject({ championName: "Ahri", opponent: "Zed", keystone: 8112, items: [3089, 3020, 1058], win: true });
  });
});
