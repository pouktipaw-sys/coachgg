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

describe("méta : modes, timeline, meilleurs joueurs, notifications de patch", async () => {
  const { championLeaders } = await import("@/server/meta");
  const { fakeTimeline } = await import("../fixtures/metaMatch");
  const { setDdragonFetcher } = await import("@/server/riot/ddragon");
  const { checkNewPatch } = await import("@/server/patchNotes");
  const { makeUser } = await import("./helpers");

  it("collecte classée + ARAM avec timeline : sorts, ordre des sorts et des objets, meilleurs joueurs", async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "MetaMatch","MetaPatch","MetaChampionStat","MetaBan","MetaItemStat","MetaRunePage","MetaMatchup","MetaChoice","MetaPlayerChampion"`);
    setDdragonFetcher(async (url) => {
      const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
      if (url.endsWith("versions.json")) return j(["15.20.1"]);
      if (url.endsWith("/item.json")) return j({ data: Object.fromEntries([1058, 1001, 3089, 3020, 3157].map((id) => [String(id), { name: `Objet ${id}`, gold: { total: id >= 3000 ? 3000 : 400, purchasable: true }, tags: [], image: { full: "" } }])) });
      return new Response("{}", { status: 404 });
    });
    const ranked = Array.from({ length: 12 }, (_, i) => fakeRanked(`EUW1_R${i}`, i % 4 !== 0));
    const aram = Array.from({ length: 4 }, (_, i) => ({ ...fakeRanked(`EUW1_A${i}`, true), info: { ...fakeRanked(`EUW1_A${i}`, true).info, queueId: 450 } }));
    const all = [...ranked, ...aram];
    const client = new RiotClient("k", async (url: string) => {
      const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
      if (url.includes("/challengerleagues/")) return j({ entries: [{ puuid: "A", leaguePoints: 1, wins: 1, losses: 1 }] });
      if (url.includes("/grandmasterleagues/")) return j({ entries: [] });
      if (url.includes("/ids?")) return j((url.includes("queue=450") ? aram : ranked).map((g) => g.metadata.matchId));
      const tl = /\/matches\/(EUW1_\w+)\/timeline$/.exec(url);
      if (tl) return j(fakeTimeline(all.find((g) => g.metadata.matchId === tl[1])!));
      const m = /\/matches\/(EUW1_\w+)$/.exec(url);
      if (m) return j(all.find((g) => g.metadata.matchId === m[1])!);
      return new Response("{}", { status: 404 });
    });
    const r = await crawlMeta("EUW1", 100, client, { modes: ["RANKED", "ARAM"], timelines: true });
    expect(r.byMode).toEqual({ RANKED: 12, ARAM: 4 });
    const b = (await metaBuild(3))!;
    expect(b.spells[0]).toMatchObject({ key: "4,14", pickrate: 100 });
    expect(b.skills[0]).toMatchObject({ key: "Q>E>W", pickrate: 100 });
    expect(b.core[0]).toMatchObject({ key: "3089>3020>3157" });
    const ar = (await metaBuild(3, "ANY", undefined, "ARAM"))!;
    expect(ar).toMatchObject({ role: "ANY", games: 4, patch: "15.20@ARAM" });
    const leaders = await championLeaders(3);
    expect(leaders[0]).toMatchObject({ riotId: "Joueur2#EUW", games: 12, platform: "EUW1" }); // ARAM non compté
    setDdragonFetcher(null);
  });

  it("nouveau patch : version mémorisée la 1re fois, puis changements chiffrés de SES champions notifiés", async () => {
    await prisma.appState.deleteMany({ where: { key: "ddragon.version" } });
    const u = await makeUser("Patch");
    await prisma.playerProfile.upsert({ where: { userId: u.id }, update: { favoriteChampions: ["Ahri", "Zed"] }, create: { userId: u.id, favoriteChampions: ["Ahri", "Zed"] } });
    let version = "15.20.1";
    const detail = (id: string, v: string) => ({ data: { [id]: { id, name: id, stats: { hp: id === "Ahri" && v === "15.21.1" ? 610 : 590 }, spells: [{ name: "Q", cooldownBurn: "7" }] } } });
    setDdragonFetcher(async (url) => {
      const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
      if (url.endsWith("versions.json")) return j([version]);
      if (url.endsWith("/champion.json")) return j({ data: { Ahri: { id: "Ahri", key: "103", name: "Ahri", title: "", tags: [], blurb: "", image: { full: "" } }, Zed: { id: "Zed", key: "238", name: "Zed", title: "", tags: [], blurb: "", image: { full: "" } } } });
      const m = /cdn\/([\d.]+)\/data\/fr_FR\/champion\/(\w+)\.json$/.exec(url);
      if (m) return j(detail(m[2]!, m[1]!));
      return new Response("{}", { status: 404 });
    });
    expect(await checkNewPatch()).toMatchObject({ changed: false, notified: 0 });
    version = "15.21.1";
    setDdragonFetcher(async (url) => {
      const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
      if (url.endsWith("versions.json")) return j([version]);
      if (url.endsWith("/champion.json")) return j({ data: { Ahri: { id: "Ahri", key: "103", name: "Ahri", title: "", tags: [], blurb: "", image: { full: "" } }, Zed: { id: "Zed", key: "238", name: "Zed", title: "", tags: [], blurb: "", image: { full: "" } } } });
      const m = /cdn\/([\d.]+)\/data\/fr_FR\/champion\/(\w+)\.json$/.exec(url);
      if (m) return j(detail(m[2]!, m[1]!));
      return new Response("{}", { status: 404 });
    });
    const r = await checkNewPatch();
    expect(r).toMatchObject({ changed: true, version: "15.21.1" });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: u.id, type: "patch" } });
    expect(n.title).toBe("Patch 15.21 : 1 de tes champions changent");
    expect(n.body).toBe("Ahri : PV de base : 590 → 610");
    expect(await checkNewPatch()).toMatchObject({ changed: false }); // une seule fois par patch
    setDdragonFetcher(null);
  });
});

describe("méta par rang et serveur, build contre un adversaire, synergies, suivi des LP", async () => {
  const { metaOverview, metaVersus, metaSynergies, metaTierList } = await import("@/server/meta");
  const { refreshRank } = await import("@/server/riot/import");
  const { makeUser } = await import("./helpers");

  it("collecte par rang : seaux global, serveur, rang, rang+serveur ; contre un adversaire ; synergies", async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "MetaMatch","MetaPatch","MetaChampionStat","MetaBan","MetaItemStat","MetaRunePage","MetaMatchup","MetaChoice","MetaPlayerChampion"`);
    const games = Array.from({ length: 10 }, (_, i) => fakeRanked(`EUW1_G${i}`, i % 5 !== 0));
    const client = new RiotClient("k", async (url: string) => {
      const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
      if (url.includes("/league-exp/v4/entries/RANKED_SOLO_5x5/GOLD/")) return j([{ puuid: "G1", tier: "GOLD", rank: "II", leaguePoints: 10 }]);
      if (url.includes("/ids?")) return j(games.map((g) => g.metadata.matchId));
      const m = /\/matches\/(EUW1_\w+)$/.exec(url);
      if (m) return j(games.find((g) => g.metadata.matchId === m[1])!);
      return new Response("{}", { status: 404 });
    });
    const r = await crawlMeta("EUW1", 100, client, { tiers: ["GOLD"] });
    expect(r).toMatchObject({ added: 10, byTier: { GOLD: 10 } });
    for (const key of ["15.20", "15.20~P:EUW1", "15.20~T:GOLD", "15.20~T:GOLD~P:EUW1"])
      expect((await prisma.metaPatch.findUniqueOrThrow({ where: { patch: key } })).games).toBe(10);
    const ov = (await metaOverview(undefined, "RANKED", "GOLD", "EUW1"))!;
    expect(ov).toMatchObject({ key: "15.20~T:GOLD~P:EUW1", tier: "GOLD", platform: "EUW1", games: 10 });
    expect(await metaOverview(undefined, "RANKED", "DIAMOND")).toBeNull(); // aucun seau Diamant : rien d'inventé
    expect((await metaTierList(ov.key, "MIDDLE")).games).toBe(10);
    const vs = (await metaVersus(3, "MIDDLE", 8, "15.20"))!;
    expect(vs).toMatchObject({ games: 10, winrate: 80, runes: { games: 10 } });
    const syn = await metaSynergies(3, "MIDDLE", "15.20");
    expect(syn.find((g) => g.role === "JUNGLE")!.best[0]).toMatchObject({ allyId: 2, games: 10, winrate: 80 });
  });

  it("suivi des LP : une photo par changement de rang, pas de doublon", async () => {
    const u = await makeUser("Lp");
    const id = await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Lp", tagLine: "EUW", platform: "EUW1", puuid: "LP1" } });
    let lp = 40;
    const client = new RiotClient("k", async () => new Response(JSON.stringify([{ queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "II", leaguePoints: lp, wins: 10, losses: 9 }]), { status: 200 }));
    await refreshRank(u.id, id.id, client);
    await refreshRank(u.id, id.id, client); // inchangé : pas de nouvelle photo
    lp = 62;
    await refreshRank(u.id, id.id, client);
    const snaps = await prisma.rankSnapshot.findMany({ where: { identityId: id.id }, orderBy: { at: "asc" } });
    expect(snaps.map((x) => x.lp)).toEqual([40, 62]);
  });
});
