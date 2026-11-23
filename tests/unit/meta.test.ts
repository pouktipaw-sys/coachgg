import { describe, expect, it } from "vitest";
import { metaRows, parseRunePageKey, patchOf, runePageKey, tierList } from "@/lib/riot/meta";

import { fakeRanked } from "../fixtures/metaMatch";

describe("statistiques méta", () => {
  it("une partie classée → champions, bannis, objets, page de runes complète, matchups", () => {
    const r = metaRows(fakeRanked("EUW1_1", true))!;
    expect(r.patch).toBe("15.20");
    expect(r.champs).toHaveLength(10);
    expect(r.champs[0]).toEqual({ championId: 1, role: "TOP", win: true });
    expect(r.bans.sort()).toEqual([98, 99]); // -1 (aucun bannissement) ignoré
    expect(r.items.filter((i) => i.championId === 1).map((i) => i.itemId)).toEqual([3089, 3020]);
    expect(r.runes[0]!.pageKey).toBe("8100|8000|8112,8139,8138,8135,9111,8014|5008,5008,5011");
    expect(r.matchups[0]).toEqual({ championId: 1, role: "TOP", opponentId: 6, win: true });
  });
  it("parties inutilisables : écourtées (< 15 min) ou rôles inconnus", () => {
    expect(metaRows(fakeRanked("x", true, undefined, 600))).toBeNull();
    const m = fakeRanked("y", true);
    m.info.participants[3]!.teamPosition = "";
    expect(metaRows(m)).toBeNull();
  });
  it("clé de page de runes ↔ format du client LoL (6 runes + 3 fragments)", () => {
    const key = runePageKey(fakeRanked("z", true).info.participants[0]!.perks!)!;
    expect(parseRunePageKey(key)).toEqual({ primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: [8112, 8139, 8138, 8135, 9111, 8014, 5008, 5008, 5011] });
    expect(patchOf("14.3.1")).toBe("14.3");
  });
  it("tier list : échantillon minimum, taux ajusté (petit échantillon ramené vers 50 %), paliers", () => {
    const stats = [
      { championId: 1, role: "MIDDLE", games: 400, wins: 220 }, // 55 % sur beaucoup de parties
      { championId: 2, role: "MIDDLE", games: 25, wins: 17 }, // 68 % sur peu de parties
      { championId: 3, role: "MIDDLE", games: 300, wins: 141 }, // 47 %
      { championId: 4, role: "MIDDLE", games: 10, wins: 10 }, // trop peu : exclu
    ];
    const t = tierList(stats, 1000, new Map([[1, 150]]), 20);
    expect(t.map((r) => r.championId)).toEqual([1, 2, 3]);
    expect(t[0]).toMatchObject({ winrate: 55, pickrate: 40, banrate: 15, tier: "S+" });
    expect(t.map((r) => r.tier)).toEqual(["S+", "A", "C"]); // paliers par centile (0 %, 33 %, 67 %)
  });
});

describe("méta : sorts, ordre des sorts et des objets, modes", async () => {
  const { skillOrder, timelineChoices, metaPatchKey, modeOfPatchKey } = await import("@/lib/riot/meta");
  const { fakeTimeline } = await import("../fixtures/metaMatch");
  const { championChanges } = await import("@/lib/riot/patchDiff");
  it("ordre de montée : sort monté à 5 en premier ; partie trop courte = inconnu", () => {
    expect(skillOrder([1, 3, 2, 1, 1, 4, 1, 3, 1, 4, 3, 3, 2, 3, 2])).toBe("Q>E>W");
    expect(skillOrder([1, 2, 3, 1])).toBeNull();
  });
  it("timeline : ordre des sorts et 3 premiers objets finis dans l'ordre d'achat", () => {
    const m = fakeRanked("EUW1_7", true);
    const c = timelineChoices(fakeTimeline(m) as never, m, "RANKED", (id) => id >= 3000);
    expect(c.filter((x) => x.championId === 1)).toEqual([
      { championId: 1, role: "TOP", kind: "skills", key: "Q>E>W", win: true },
      { championId: 1, role: "TOP", kind: "core", key: "3089>3020>3157", win: true },
    ]);
  });
  it("sorts d'invocateur et joueurs (classée) ; ARAM sans rôle ni matchup ; Arena : victoire = top 4", () => {
    const r = metaRows(fakeRanked("EUW1_8", true))!;
    expect(r.choices[0]).toEqual({ championId: 1, role: "TOP", kind: "spells", key: "4,14", win: true });
    expect(r.players[0]).toEqual({ puuid: "p0", riotId: "Joueur0#EUW", championId: 1, win: true });
    const aram = metaRows({ ...fakeRanked("EUW1_9", true), info: { ...fakeRanked("EUW1_9", true).info, queueId: 450 } }, "ARAM")!;
    expect(aram.patch).toBe("15.20@ARAM");
    expect(aram.champs[0]!.role).toBe("ANY");
    expect(aram.matchups).toEqual([]);
    expect(aram.players).toEqual([]);
    const base = fakeRanked("EUW1_10", true);
    const arena = { ...base, info: { ...base.info, queueId: 1700, participants: Array.from({ length: 16 }, (_, i) => ({ ...base.info.participants[i % 10]!, championId: 100 + i, teamPosition: "", placement: Math.floor(i / 2) + 1, win: i < 2 })) } };
    const ar = metaRows(arena, "ARENA")!;
    expect(ar.champs.filter((c) => c.win)).toHaveLength(8); // places 1 à 4 = 8 joueurs
    expect(metaPatchKey("15.20", "ARENA")).toBe("15.20@ARENA");
    expect(modeOfPatchKey("15.20@ARAM")).toBe("ARAM");
  });
  it("patch : changements chiffrés des statistiques et des sorts", () => {
    const before = { name: "Ahri", stats: { hp: 590, armor: 21 }, spells: [{ name: "Orbe", cooldownBurn: "7", costBurn: "55/65", rangeBurn: "970" }] };
    const after = { name: "Ahri", stats: { hp: 610, armor: 21 }, spells: [{ name: "Orbe", cooldownBurn: "6", costBurn: "55/65", rangeBurn: "970" }] };
    expect(championChanges(before, after)).toEqual(["PV de base : 590 → 610", "Q (Orbe) : récupération 7 → 6 s"]);
    expect(championChanges(before, before)).toEqual([]);
  });
});
