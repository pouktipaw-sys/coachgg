import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Lcu, parseLockfile, readChampSelect, type ChampSelect, type LcuTransport } from "../../desktop/src/lcu";
import { ChampSelectAssistant } from "../../desktop/src/champselect";
import { configSchema } from "../../desktop/src/config";
import { AUTOSTART_FILE, autostartScript, setAutostart } from "../../desktop/src/autostart";
import type { CoachApi } from "../../desktop/src/api";

const session = (locked: boolean): ChampSelect => ({
  localPlayerCellId: 2,
  myTeam: [{ cellId: 0, championId: 64 }, { cellId: 2, championId: 103, assignedPosition: "middle" }],
  theirTeam: [{ cellId: 7, championId: 238, assignedPosition: "middle" }, { cellId: 8, championId: 0 }],
  bans: { myTeamBans: [157], theirTeamBans: [-1] },
  actions: [[{ actorCellId: 2, championId: 103, completed: locked, type: "pick" }]],
});

/** Faux client LoL : mémorise les appels, renvoie la sélection et les pages existantes. */
function fakeClient(s: ChampSelect | null) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const t: LcuTransport = async (method, p, body) => {
    calls.push({ method, path: p, body });
    if (p === "/lol-champ-select/v1/session") return s ? { status: 200, data: s } : { status: 404, data: null };
    if (p === "/lol-summoner/v1/current-summoner") return { status: 200, data: { summonerId: 42 } };
    if (p === "/lol-perks/v1/pages" && method === "GET") return { status: 200, data: [{ id: 1, name: "Page 1", isDeletable: false, current: false }, { id: 9, name: "CoachGG MIDDLE 15.19", isDeletable: true, current: true }] };
    if (p.startsWith("/lol-item-sets/") && method === "GET") return { status: 200, data: { itemSets: [{ title: "Mon set", associatedChampions: [103] }, { title: "CoachGG ancien", associatedChampions: [103] }], timestamp: 1 } };
    return { status: 204, data: null };
  };
  return { lcu: new Lcu(t), calls };
}

describe("client LoL : sélection des champions", () => {
  it("lockfile et lecture de la sélection (rôle, champion verrouillé, pris et bannis, adversaire de voie)", () => {
    expect(parseLockfile("LeagueClient:1234:54321:secret:https")).toEqual({ port: 54321, password: "secret", protocol: "https" });
    expect(parseLockfile("invalide")).toBeNull();
    expect(readChampSelect(session(false))).toEqual({ role: "MIDDLE", championId: 103, locked: false, taken: [64, 238, 157], enemyLaner: 238 });
    expect(readChampSelect(session(true)).locked).toBe(true);
  });

  it("import : remplace l'ancienne page CoachGG, crée la nouvelle active ; ensemble d'objets du champion remplacé", async () => {
    const { lcu, calls } = fakeClient(session(true));
    expect(await lcu.applyRunes({ primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: [8112, 8139, 8138, 8135, 9111, 8014, 5008, 5008, 5011] }, "CoachGG MIDDLE 15.20")).toBe(true);
    expect(calls.find((c) => c.method === "DELETE")!.path).toBe("/lol-perks/v1/pages/9");
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ name: "CoachGG MIDDLE 15.20", current: true, selectedPerkIds: expect.arrayContaining([8112]) });
    expect(await lcu.applyItemSet(42, 103, "CoachGG MIDDLE (15.20)", [3089, 3020])).toBe(true);
    const put = calls.find((c) => c.method === "PUT")!.body as { itemSets: { title: string }[] };
    expect(put.itemSets.map((x) => x.title)).toEqual(["Mon set", "CoachGG MIDDLE (15.20)"]); // set perso conservé
  });

  it("assistant : conseils pendant la sélection, import une seule fois au verrouillage, rien sans appairage", async () => {
    let s: ChampSelect | null = session(false);
    const calls: { method: string; path: string }[] = [];
    const lcuOf = () =>
      new Lcu(async (method, p) => {
        if (p === "/lol-champ-select/v1/session") return s ? { status: 200, data: s } : { status: 404, data: null };
        calls.push({ method, path: p });
        if (p === "/lol-summoner/v1/current-summoner") return { status: 200, data: { summonerId: 42 } };
        if (method === "GET") return { status: 200, data: p.endsWith("/pages") ? [] : { itemSets: [] } };
        return { status: 204, data: null };
      });
    let builds = 0;
    const api = {
      metaBuild: async () => (builds++, { build: { patch: "15.20", role: "MIDDLE", games: 400, winrate: 53, runes: { primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, items: [{ itemId: 3089, name: "Coiffe" }] } }),
      draftAdvice: async () => ({ advice: { patch: "15.20", counters: [{ championId: 1, name: "Annie", winrate: 55, games: 40 }], best: [], bans: [] } }),
    } as unknown as CoachApi;
    const unpaired = new ChampSelectAssistant(configSchema.parse({}), api, lcuOf);
    await unpaired.tick();
    expect(unpaired.message).toMatch(/appaire ce PC/);
    const a = new ChampSelectAssistant(configSchema.parse({ deviceToken: "t" }), api, lcuOf);
    await a.tick();
    expect(a.snapshot()).toMatchObject({ status: "in_champ_select", advice: { counters: [{ name: "Annie" }] } });
    expect(builds).toBe(0); // pas encore verrouillé
    s = session(true);
    await a.tick();
    await a.tick();
    expect(builds).toBe(1); // une seule fois par sélection
    expect(a.message).toMatch(/page de runes et ensemble d'objets/);
    expect(calls.filter((c) => c.method === "POST" && c.path === "/lol-perks/v1/pages")).toHaveLength(1);
    s = null;
    await a.tick();
    expect(a.status).toBe("idle");
    expect(new ChampSelectAssistant(configSchema.parse({ deviceToken: "t" }), api, () => null).status).toBe("client_closed");
  });

  it("lancement automatique Windows : script dans le dossier Démarrage, retirable", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "startup-"));
    const on = setAutostart(true, "C:\\coachgg", dir);
    expect(on.enabled).toBe(true);
    expect(readFileSync(path.join(dir, AUTOSTART_FILE), "utf8")).toBe(autostartScript("C:\\coachgg"));
    expect(autostartScript("C:\\coachgg")).toContain('cd /d "C:\\coachgg"');
    setAutostart(false, "C:\\coachgg", dir);
    expect(existsSync(path.join(dir, AUTOSTART_FILE))).toBe(false);
    expect(() => setAutostart(true, "x", null)).toThrow(/Windows/);
  });
});

describe("application PC : écran de chargement", () => {
  it("au début de la partie, les joueurs sont récupérés et exposés à l'interface locale", async () => {
    const { Agent } = await import("../../desktop/src/agent");
    const home = mkdtempSync(path.join(os.tmpdir(), "agent-"));
    const game = { mode: "CLASSIC", teams: [{ teamId: 100, bans: [], players: [{ riotId: "Moi#EUW", isMe: true, champion: "Ahri", spells: [], rank: null, winrate: null, mastery: null }] }] };
    const api = { liveGame: async () => ({ account: { gameName: "Moi", tagLine: "EUW" }, game }) } as unknown as CoachApi;
    const a = new Agent(configSchema.parse({ deviceToken: "t", capture: { backend: "none" } }), { home, api, lcu: () => null, log: () => {} });
    await a.fetchLoadingScreen();
    expect(a.status().loadingScreen).toEqual(game);
  });
});
