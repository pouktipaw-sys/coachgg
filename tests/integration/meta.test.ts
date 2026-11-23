// Collecte « méta » (serveur Riot simulé) : agrégats, idempotence, tier list, build, aide à la sélection.
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { RiotClient } from "@/server/riot/client";
import { crawlMeta, draftAdvice, metaBuild, metaTierList, scheduleMetaCrawls } from "@/server/meta";
import { fakeRanked } from "../fixtures/metaMatch";

describe("statistiques méta", () => {
  it("collecte : parties comptées une seule fois, agrégats, tier list, build, contres, aide à la sélection", async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "MetaMatch","MetaPatch","MetaChampionStat","MetaBan","MetaItemStat","MetaRunePage","MetaMatchup"`);
    // 30 parties : le champion 3 (milieu, bleu) gagne 2 fois sur 3 contre le 8 (milieu, rouge)
    const games = Array.from({ length: 30 }, (_, i) => fakeRanked(`EUW1_${i}`, i % 3 !== 0));
    let fetched = 0;
    const client = new RiotClient("k", async (url: string) => {
      const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
      if (url.includes("/challengerleagues/")) return j({ entries: [{ puuid: "A", leaguePoints: 1, wins: 1, losses: 1 }, { puuid: "B", leaguePoints: 1, wins: 1, losses: 1 }] });
      if (url.includes("/grandmasterleagues/")) return j({ entries: [] });
      if (url.includes("/ids?")) {
        expect(url).toContain("queue=420");
        return j(url.includes("/A/") ? games.slice(0, 20).map((g) => g.metadata.matchId) : games.slice(10).map((g) => g.metadata.matchId));
      }
      const m = /\/matches\/(EUW1_\d+)$/.exec(url);
      if (m) {
        fetched++;
        return j(games.find((g) => g.metadata.matchId === m[1])!);
      }
      return new Response("{}", { status: 404 });
    });
    const r1 = await crawlMeta("EUW1", 1000, client);
    expect(r1).toMatchObject({ added: 30, seeds: 2 });
    expect(fetched).toBe(30); // les parties en commun entre A et B ne sont demandées qu'une fois
    const r2 = await crawlMeta("EUW1", 1000, client);
    expect(r2.added).toBe(0);
    expect(fetched).toBe(30);

    expect((await prisma.metaPatch.findUniqueOrThrow({ where: { patch: "15.20" } })).games).toBe(30);
    const mid = await prisma.metaChampionStat.findUniqueOrThrow({ where: { patch_championId_role: { patch: "15.20", championId: 3, role: "MIDDLE" } } });
    expect(mid).toMatchObject({ games: 30, wins: 20 });

    const tl = await metaTierList("15.20", "MIDDLE");
    expect(tl.rows.map((x) => x.championId)).toEqual([3, 8]);
    expect(tl.rows[0]).toMatchObject({ winrate: 66.7, pickrate: 100, tier: "S+" });

    const b = (await metaBuild(3))!;
    expect(b).toMatchObject({ role: "MIDDLE", games: 30, winrate: 66.7 });
    expect(b.items.map((x) => x.itemId).sort()).toEqual([3020, 3089]); // à égalité (30 parties chacun)
    expect(b.items[0]).toMatchObject({ games: 30, pickrate: 100 });
    expect(b.runes[0]!.pageKey).toMatch(/^8100\|8000\|/);
    expect(b.strongAgainst[0]).toMatchObject({ opponentId: 8, winrate: 66.7 });

    const d = (await draftAdvice({ role: "MIDDLE", enemyLaner: 8, taken: [8] }))!;
    expect(d.counters[0]).toMatchObject({ championId: 3, winrate: 66.7 });
    expect(d.best[0]!.championId).toBe(3);
    expect(d.bans.map((x) => x.championId)).not.toContain(8);
  });

  it("planification désactivée par défaut, une collecte par heure et par serveur sinon", async () => {
    const before = process.env.META_CRAWL_PLATFORMS;
    const key = process.env.RIOT_API_KEY;
    delete process.env.META_CRAWL_PLATFORMS;
    expect(await scheduleMetaCrawls()).toBe(0);
    process.env.META_CRAWL_PLATFORMS = "euw1,kr";
    process.env.RIOT_API_KEY = "k";
    const at = new Date("2026-11-23T10:15:00Z");
    expect(await scheduleMetaCrawls(at)).toBe(2);
    await scheduleMetaCrawls(at);
    expect(await prisma.analysisJob.count({ where: { type: "META_CRAWL", idempotencyKey: { startsWith: "meta:" } } })).toBe(2);
    process.env.META_CRAWL_PLATFORMS = before ?? "";
    if (key === undefined) delete process.env.RIOT_API_KEY;
    else process.env.RIOT_API_KEY = key;
    await prisma.analysisJob.deleteMany({ where: { type: "META_CRAWL" } });
  });
});
