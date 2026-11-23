import { describe, expect, it } from "vitest";
import { buildStats, byChampion, byOpponent, byRole, sampleNote, summarize, type GameRow } from "@/lib/riot/insights";
import { ddText, findChampion, isFinishedItem, normChamp, type DdChampion, type DdItem } from "@/server/riot/ddragon";
import { runesOf } from "@/server/riot/client";

const g = (o: Partial<GameRow>): GameRow => ({ win: true, championName: "Ahri", role: "MIDDLE", kills: 5, deaths: 2, assists: 7, cs: 200, durationSec: 1500, ...o });

describe("statistiques sur des parties réelles", () => {
  it("résumé : taux de victoire, KDA global, sbires par minute", () => {
    const s = summarize([g({ win: true, kills: 10, deaths: 2, assists: 6 }), g({ win: false, kills: 2, deaths: 6, assists: 2 })]);
    expect(s).toMatchObject({ games: 2, wins: 1, winrate: 50, kda: 2.5, csMin: 8, killsAvg: 6, deathsAvg: 4 });
    expect(summarize([])).toMatchObject({ games: 0, winrate: null, kda: null, csMin: null });
  });
  it("regroupements par champion, rôle et adversaire (avec un minimum de parties)", () => {
    const games = [g({}), g({ win: false }), g({ championName: "Zed", opponent: "Yasuo" }), g({ opponent: "Yasuo", win: false }), g({ opponent: "Yasuo", win: false }), g({ role: "TOP", opponent: "Darius" })];
    expect(byChampion(games)[0]).toMatchObject({ name: "Ahri", games: 5 });
    expect(byRole(games).map((r) => r.name)).toEqual(["MIDDLE", "TOP"]);
    expect(byOpponent(games)).toEqual([expect.objectContaining({ name: "Yasuo", games: 3, winrate: 33 })]); // Darius : 1 seule partie, écarté
  });
  it("builds : objets finis et rune clé, avec fréquence et taux de victoire", () => {
    const finished = (id: number) => id >= 3000;
    const games = [g({ items: [3089, 1058, 3020], keystone: 8112 }), g({ items: [3089, 3157], keystone: 8112, win: false }), g({ items: [1058], keystone: 8214 })];
    const b = buildStats(games, finished);
    expect(b.items[0]).toEqual({ id: 3089, games: 2, wins: 1, winrate: 50 });
    expect(b.items.map((i) => i.id)).not.toContain(1058); // composant ignoré
    expect(b.keystones[0]).toEqual({ id: 8112, games: 2, wins: 1, winrate: 50 });
  });
  it("taille d'échantillon annoncée honnêtement", () => {
    expect(sampleNote(3)).toMatch(/tendance à confirmer/);
    expect(sampleNote(12)).toMatch(/modeste/);
  });
});

describe("données officielles du jeu", () => {
  const champs = [{ id: "MonkeyKing", key: "62", name: "Wukong" }, { id: "Kaisa", key: "145", name: "Kai'Sa" }] as DdChampion[];
  it("retrouve un champion par id interne, nom affiché ou numéro", () => {
    expect(findChampion(champs, "MonkeyKing")?.name).toBe("Wukong");
    expect(findChampion(champs, "wukong")?.id).toBe("MonkeyKing");
    expect(findChampion(champs, "Kai'Sa")?.key).toBe("145");
    expect(findChampion(champs, 145)?.name).toBe("Kai'Sa");
    expect(normChamp("Kai'Sa")).toBe("kaisa");
  });
  it("descriptions lisibles et objets finis", () => {
    expect(ddText("Inflige <magicDamage>80 dégâts</magicDamage>.<br><br>Ralentit.")).toBe("Inflige 80 dégâts.\n\nRalentit.");
    const it = (o: Partial<DdItem>) => ({ name: "x", gold: { total: 3000, purchasable: true }, tags: [], image: { full: "" }, ...o }) as DdItem;
    expect(isFinishedItem(it({}))).toBe(true);
    expect(isFinishedItem(it({ into: ["3089"] }))).toBe(false);
    expect(isFinishedItem(it({ gold: { total: 900, purchasable: true } }))).toBe(false);
    expect(isFinishedItem(it({ tags: ["Boots"], depth: 2, gold: { total: 1100, purchasable: true } }))).toBe(true);
    expect(isFinishedItem(it({ tags: ["Consumable"] }))).toBe(false);
  });
  it("runes d'un participant", () => {
    expect(runesOf({ perks: { styles: [{ style: 8100, selections: [{ perk: 8112 }] }, { style: 8000, selections: [] }] } })).toEqual({ keystone: 8112, primaryStyle: 8100, subStyle: 8000 });
    expect(runesOf({})).toBeNull();
  });
});
