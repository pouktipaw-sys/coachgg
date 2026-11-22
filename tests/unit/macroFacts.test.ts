import { describe, expect, it } from "vitest";
import { laneSentence, laneSummary, macroMistakes, shopVisits } from "@/lib/riot/macroFacts";
import type { CompactTimeline } from "@/lib/riot/timelineFacts";

// Partie de 25 min, une mesure par minute. Joueur 1 (ME, mid, équipe 100) contre joueur 6 (Zed, mid, équipe 200).
function game(opts: { cur?: (m: number) => number; cs?: (m: number) => number; oppCs?: (m: number) => number; buys?: number[]; objectives?: CompactTimeline["objectives"]; kills?: CompactTimeline["kills"]; role?: string }): CompactTimeline {
  const participants = Array.from({ length: 10 }, (_, i) => ({
    pid: i + 1, puuid: i === 0 ? "ME" : `P${i + 1}`, teamId: i < 5 ? 100 : 200,
    champion: ["Ahri", "Vi", "Garen", "Jinx", "Lulu", "Zed", "Lee Sin", "Darius", "Kai'Sa", "Nami"][i]!,
    role: ["MIDDLE", "JUNGLE", "TOP", "BOTTOM", "UTILITY"][i % 5]!,
  }));
  if (opts.role) participants[0]!.role = opts.role;
  const frames = Array.from({ length: 26 }, (_, m) => {
    const rec = <T,>(f: (i: number) => T): Record<string, T> => Object.fromEntries(participants.map((p) => [String(p.pid), f(p.pid)]));
    let csMe = 0;
    for (let k = 1; k <= m; k++) csMe += opts.cs ? opts.cs(k) : 7;
    let csOpp = 0;
    for (let k = 1; k <= m; k++) csOpp += opts.oppCs ? opts.oppCs(k) : 7;
    return {
      t: m * 60_000,
      pos: rec(() => ({ x: 7400, y: 7400 })),
      gold: rec((pid) => 500 + m * (pid === 1 ? 380 : 400)),
      level: rec(() => Math.min(18, 1 + Math.floor(m / 1.5))),
      cur: rec((pid) => (pid === 1 && opts.cur ? opts.cur(m) : 300)),
      cs: rec((pid) => (pid === 1 ? csMe : pid === 6 ? csOpp : 6 * m)),
    };
  });
  return {
    v: 2, participants, frames, kills: opts.kills ?? [], objectives: opts.objectives ?? [], wards: [],
    buys: (opts.buys ?? []).map((t) => ({ t, pid: 1 })),
  };
}

describe("erreurs sans mort (timeline Riot)", () => {
  it("retour raté : 1 500 or ou plus gardés plus de 2 minutes sans boutique", () => {
    const ct = game({ cur: (m) => (m >= 8 && m <= 12 ? 1600 + (m - 8) * 300 : 300) });
    const [m] = macroMistakes(ct, "ME").filter((x) => x.kind === "MISSED_BACK");
    expect(m).toMatchObject({ flag: "missed_back", t: 8 * 60_000, endT: 12 * 60_000, facts: { gold: 2800, minutes: 4 } });
    expect(m!.title).toMatch(/Retour raté : 2 800 or gardé 4 min sans rentrer \(8:00–12:00\)/);
  });

  it("pas de retour raté si le joueur passe à la boutique ou si ça dure moins de 2 min", () => {
    expect(macroMistakes(game({ cur: (m) => (m >= 8 && m <= 9 ? 1800 : 300) }), "ME").filter((x) => x.kind === "MISSED_BACK")).toHaveLength(0);
    const shopped = game({ cur: (m) => (m >= 8 && m <= 12 ? 1800 : 300), buys: [9 * 60_000 + 20_000, 9 * 60_000 + 25_000] });
    expect(macroMistakes(shopped, "ME").filter((x) => x.kind === "MISSED_BACK")).toHaveLength(0);
  });

  it("retour au mauvais moment : achat à la base peu avant un dragon pris par l'ennemi", () => {
    const ct = game({ buys: [14 * 60_000, 14 * 60_000 + 5000], objectives: [{ t: 14 * 60_000 + 50_000, kind: "DRAGON", team: 200 }] });
    const [m] = macroMistakes(ct, "ME").filter((x) => x.kind === "BAD_BACK");
    expect(m).toMatchObject({ flag: "bad_back", t: 14 * 60_000 - 10_000, facts: { objective: "le dragon", afterSec: 50 } });
    expect(m!.title).toBe("Retour à la base 50 s avant que l'ennemi prenne le dragon (14:50)");
    // Dragon pris par SON équipe, ou achat bien avant : rien.
    expect(macroMistakes(game({ buys: [14 * 60_000], objectives: [{ t: 14 * 60_000 + 50_000, kind: "DRAGON", team: 100 }] }), "ME").filter((x) => x.kind === "BAD_BACK")).toHaveLength(0);
    expect(macroMistakes(game({ buys: [12 * 60_000], objectives: [{ t: 14 * 60_000 + 50_000, kind: "DRAGON", team: 200 }] }), "ME").filter((x) => x.kind === "BAD_BACK")).toHaveLength(0);
  });

  it("sbires perdus : au moins 2 minutes de suite très en dessous du rythme habituel, en vie", () => {
    const ct = game({ cs: (k) => (k >= 11 && k <= 13 ? 1 : 8) });
    const [m] = macroMistakes(ct, "ME").filter((x) => x.kind === "CS_DROP");
    expect(m).toMatchObject({ flag: "cs_drop", t: 10 * 60_000, endT: 13 * 60_000, facts: { csDone: 3, csUsual: 8, csLost: 21, minutes: 3 } });
    expect(m!.title).toBe("Sbires perdus de 10:00 à 13:00 (environ −21)");
  });

  it("une seule minute basse (retour à la base) ou une mort n'est pas comptée ; le support est ignoré", () => {
    expect(macroMistakes(game({ cs: (k) => (k === 11 ? 0 : 8) }), "ME").filter((x) => x.kind === "CS_DROP")).toHaveLength(0);
    // Mort à 11:10 (niveau 8 : ~21 s) : la minute 11 compte comme « mort » ; reste une seule minute basse → pas d'erreur de sbires.
    const deaths = [10 * 60_000 + 5000, 11 * 60_000 + 10_000].map((t) => ({ t, pos: { x: 7000, y: 7000 }, killer: 6, victim: 1, assists: [] }));
    const dead = game({ cs: (k) => (k >= 11 && k <= 12 ? 0 : 8), kills: deaths });
    expect(macroMistakes(dead, "ME").filter((x) => x.kind === "CS_DROP")).toHaveLength(0);
    expect(macroMistakes(game({ cs: (k) => (k >= 11 && k <= 13 ? 0 : 8), role: "UTILITY" }), "ME").filter((x) => x.kind === "CS_DROP")).toHaveLength(0);
  });

  it("bilan de voie face à l'adversaire direct à 10 et 15 min", () => {
    const s = laneSummary(game({ cs: () => 6, oppCs: () => 8 }), "ME")!;
    expect(s.opponent).toBe("Zed");
    expect(s.at).toEqual([
      { minute: 10, csDiff: -20, goldDiff: -200 },
      { minute: 15, csDiff: -30, goldDiff: -300 },
    ]);
    expect(laneSentence(s)).toBe("À 15 min face à Zed : −30 sbires, −300 or.");
  });

  it("ancienne timeline sans achats : passages à la boutique déduits de l'or en poche", () => {
    const ct = game({ cur: (m) => (m === 9 ? 1800 : m === 10 ? 200 : 300) });
    delete ct.buys;
    expect(shopVisits(ct, 1)).toEqual([10 * 60_000 - 30_000]);
  });
});

describe("présentation des erreurs sans mort", async () => {
  const { momentChips } = await import("@/lib/analysis/chips");
  const { severity } = await import("@/lib/analysis/severity");
  const { gameReportRules, recurringPatterns } = await import("@/server/analysis/ai");
  it("pastilles chiffrées", () => {
    expect(momentChips({ type: "riot_macro", macro: { kind: "CS_DROP", csLost: 21, minutes: 3 } }).map((c) => c.text)).toEqual(["−21 sbires", "≈ −420 or", "3 min"]);
    expect(momentChips({ type: "riot_macro", macro: { kind: "MISSED_BACK", gold: 2800, minutes: 4 } }).map((c) => c.text)).toEqual(["2 800 or gardé", "4 min sans rentrer"]);
    expect(momentChips({ type: "riot_macro", macro: { kind: "BAD_BACK", objective: "le dragon", afterSec: 50 } }).map((c) => c.text)).toEqual(["Retour à la base", "Dragon perdu (+50 s)"]);
  });
  it("gravité : un retour avant un objectif perdu pèse plus qu'un moment banal", () => {
    expect(severity({ kind: "MISTAKE", provenance: "AUTOMATIC", confidence: "MEDIUM", autoEvidence: { flags: ["bad_back"] } } as never)).toBeGreaterThan(
      severity({ kind: "INTERESTING", provenance: "AUTOMATIC", confidence: "LOW", autoEvidence: { flags: [] } } as never),
    );
  });
  it("bilan : erreurs récurrentes et décompte séparé des morts", () => {
    const m = (flag: string) => ({ title: "Sbires perdus", kind: "MISTAKE", category: "RESOURCES", advice: "", decisionMs: 0, automatic: true, flags: [flag] });
    expect(recurringPatterns([m("cs_drop"), m("cs_drop")])[0]!.text).toBe("2 périodes de plusieurs minutes sans tuer de sbires");
    const r = gameReportRules([m("cs_drop"), m("missed_back")]);
    expect(r.summary).toMatch(/2 moment\(s\) à revoir dans cette partie, dont 0 mort\(s\) probable\(s\) et 2 erreur\(s\) sans mort/);
  });
});
