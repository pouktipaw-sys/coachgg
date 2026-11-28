import { describe, expect, it } from "vitest";
import { rateLimitPause } from "@/server/riot/client";
import { ladderPoints, ladderTicks, lpDeltas } from "@/lib/riot/ladder";
import { orderSpells, Lcu, type ChampSelect } from "../../desktop/src/lcu";
import { pickMyStats } from "../../desktop/src/liveclient";
import { ChampSelectAssistant } from "../../desktop/src/champselect";
import { configSchema } from "../../desktop/src/config";
import type { CoachApi } from "../../desktop/src/api";

describe("quotas Riot", () => {
  it("attend la fin de la fenêtre pleine, sinon ne ralentit pas", () => {
    expect(rateLimitPause("20:1,100:120", "3:1,40:120")).toBe(0);
    expect(rateLimitPause("20:1,100:120", "20:1,40:120")).toBe(1000);
    expect(rateLimitPause("20:1,100:120", "5:1,100:120")).toBe(120_000);
    expect(rateLimitPause(null, null)).toBe(0);
  });
});

describe("suivi des LP", () => {
  it("échelle continue Fer → Maître, promotions et rétrogradations comptées", () => {
    expect(ladderPoints("IRON", "IV", 0)).toBe(0);
    expect(ladderPoints("PLATINUM", "III", 60)).toBe(1760);
    expect(ladderPoints("MASTER", "I", 120)).toBe(2920);
    const d = lpDeltas([
      { tier: "GOLD", division: "I", lp: 80, at: new Date(1) },
      { tier: "PLATINUM", division: "IV", lp: 10, at: new Date(2) }, // promotion : +30
      { tier: "GOLD", division: "I", lp: 75, at: new Date(3) }, // rétrogradation : −35
    ]);
    expect(d.map((x) => x.delta)).toEqual([30, -35]);
    expect(ladderTicks(1500, 1800).map((t) => t.label)).toEqual(["Or", "Platine"]);
  });
});

describe("application PC", () => {
  it("Saut éclair reste sur ta touche habituelle (D ou F)", () => {
    expect(orderSpells([4, 14], [12, 4])).toEqual([14, 4]); // Flash sur F
    expect(orderSpells([14, 4], [4, 7])).toEqual([4, 14]); // Flash sur D
    expect(orderSpells([4, 11], [undefined, undefined])).toEqual([4, 11]);
    expect(orderSpells([6, 14], [4, 12])).toEqual([6, 14]); // pas de Flash conseillé
  });

  it("compagnon : TES statistiques seulement", () => {
    const s = pickMyStats({ riotId: "Moi#EUW", level: 9, currentGold: 1234.7 }, [{ riotId: "Ennemi#EUW", scores: { kills: 9, creepScore: 300 } }, { riotId: "Moi#EUW", scores: { kills: 3, deaths: 1, assists: 4, creepScore: 120, wardScore: 7.25 } }], 900);
    expect(s).toEqual({ gameTimeSec: 900, level: 9, gold: 1235, kills: 3, deaths: 1, assists: 4, cs: 120, csPerMin: 8, wards: 7.3 });
    expect(pickMyStats(null, [], 10)).toBeNull();
  });

  it("acceptation auto uniquement si activée ; sorts réglés au verrouillage", async () => {
    const calls: string[] = [];
    let ready = true;
    const session: ChampSelect = {
      localPlayerCellId: 1, myTeam: [{ cellId: 1, championId: 103, assignedPosition: "middle", spell1Id: 12, spell2Id: 4 }], theirTeam: [],
      actions: [[{ actorCellId: 1, championId: 103, completed: true, type: "pick" }]],
    };
    const lcu = () => new Lcu(async (method, p, body) => {
      calls.push(`${method} ${p}${body ? " " + JSON.stringify(body) : ""}`);
      if (p === "/lol-matchmaking/v1/ready-check") return { status: 200, data: { state: ready ? "InProgress" : "Invalid", playerResponse: "None" } };
      if (p === "/lol-champ-select/v1/session") return { status: 200, data: session };
      if (p === "/lol-summoner/v1/current-summoner") return { status: 200, data: { summonerId: 1 } };
      if (method === "GET") return { status: 200, data: p.endsWith("/pages") ? [] : { itemSets: [] } };
      return { status: 204, data: null };
    });
    const api = {
      metaBuild: async () => ({ build: { patch: "15.20", role: "MIDDLE", games: 50, winrate: 52, runes: null, items: [], spells: [4, 14], skillOrder: "Q>E>W" } }),
      draftAdvice: async () => ({ advice: null }),
    } as unknown as CoachApi;
    const off = new ChampSelectAssistant(configSchema.parse({ deviceToken: "t" }), api, lcu);
    await off.tick();
    expect(calls.some((c) => c.includes("ready-check/accept"))).toBe(false); // désactivé par défaut
    expect(calls).toContain('PATCH /lol-champ-select/v1/session/my-selection {"spell1Id":14,"spell2Id":4}'); // Flash gardé sur F
    expect(off.message).toMatch(/sorts d'invocateur.*monte Q › E › W/);
    calls.length = 0;
    const on = new ChampSelectAssistant(configSchema.parse({ deviceToken: "t", champSelect: { autoAccept: true } }), api, lcu);
    await on.tick();
    expect(calls).toContain("POST /lol-matchmaking/v1/ready-check/accept");
    expect(on.message).toBe("Partie acceptée automatiquement.");
    ready = false;
  });
});
