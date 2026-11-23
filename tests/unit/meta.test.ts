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
