import { describe, expect, it } from "vitest";
import { anchorScore, computeProgression, computeScore, computeTeamMvp, type MvpEntry, type ScoringInput } from "@/lib/scoring/engine";
import { SCORE_V1 } from "@/lib/scoring/config";
import { statAdvice } from "@/lib/scoring/advice";

const full: ScoringInput = {
  role: "MIDDLE",
  durationSec: 30 * 60,
  stats: { kills: 8, deaths: 3, assists: 10, creepScore: 240, goldEarned: 13000, damageToChampions: 28000, damageToObjectives: 6000, visionScore: 24 },
  team: { kills: 30, damageToChampions: 100000, damageToObjectives: 40000 },
};

describe("note de performance v1", () => {
  it("interpole linéairement entre plancher et excellent, y compris en échelle inversée", () => {
    expect(anchorScore(4.5, { floor: 4.5, excellent: 9 })).toBe(0);
    expect(anchorScore(6.75, { floor: 4.5, excellent: 9 })).toBe(5);
    expect(anchorScore(12, { floor: 4.5, excellent: 9 })).toBe(10);
    expect(anchorScore(0.8, { floor: 4, excellent: 0.8 })).toBe(10);
    expect(anchorScore(2.4, { floor: 4, excellent: 0.8 })).toBe(5);
  });

  it("est déterministe et versionnée", () => {
    const a = computeScore(full);
    const b = computeScore(full);
    expect(a).toEqual(b);
    expect(a.version).toBe("perf-1.0.0");
    expect(a.experimental).toBe(true);
  });

  it("calcule une note complète avec fiabilité élevée", () => {
    const r = computeScore(full);
    expect(r.reliability).toBe("high");
    expect(r.overall).not.toBeNull();
    expect(r.overall!).toBeGreaterThan(4);
    expect(r.overall!).toBeLessThan(9);
    expect(r.components).toHaveLength(6);
    expect(r.missingData).toEqual([]);
    const kp = r.components.find((c) => c.key === "participation")!;
    expect(kp.value).toBeCloseTo(0.6);
    expect(kp.display).toBe("60 %");
  });

  it("ne dépend pas seulement du KDA : un KDA identique donne des notes différentes selon le reste", () => {
    const poorFarm = computeScore({ ...full, stats: { ...full.stats, creepScore: 100, visionScore: 5, damageToObjectives: 500 } });
    expect(poorFarm.overall!).toBeLessThan(computeScore(full).overall!);
  });

  it("n'intègre pas le résultat du match", () => {
    // ScoringInput n'a pas de champ win : la note est indépendante de la victoire.
    expect(Object.keys(full)).not.toContain("win");
  });

  it("renormalise en cas de données manquantes et les liste", () => {
    const r = computeScore({ ...full, stats: { ...full.stats, visionScore: null, damageToObjectives: null } });
    expect(r.overall).not.toBeNull();
    expect(r.reliability).toBe("medium");
    expect(r.missingData).toHaveLength(2);
    expect(r.missingData.join(" ")).toMatch(/vision/i);
  });

  it("refuse de noter quand trop de données manquent", () => {
    const r = computeScore({ role: "TOP", durationSec: 1800, stats: { kills: 1, deaths: 2, assists: 3 }, team: {} });
    expect(r.overall).toBeNull();
    expect(r.reliability).toBe("insufficient");
  });

  it("baisse la fiabilité d'une partie courte et d'un rôle inconnu", () => {
    expect(computeScore({ ...full, durationSec: 12 * 60 }).reliability).toBe("low");
    const unknown = computeScore({ ...full, role: null });
    expect(unknown.reliability).toBe("medium");
    expect(unknown.reliabilityReasons.join(" ")).toMatch(/Rôle inconnu/);
  });

  it("adapte les repères au rôle : un support avec peu de farm n'est pas pénalisé comme un mid", () => {
    const supportStats = { ...full.stats, creepScore: 30, visionScore: 75, damageToChampions: 9000, damageToObjectives: 2000 };
    const asSupport = computeScore({ ...full, role: "UTILITY", stats: supportStats });
    const asMid = computeScore({ ...full, role: "MIDDLE", stats: supportStats });
    expect(asSupport.overall!).toBeGreaterThan(asMid.overall!);
  });

  it("produit facteurs positifs et négatifs expliqués", () => {
    const r = computeScore({ ...full, stats: { ...full.stats, deaths: 12, visionScore: 4 } });
    expect(r.negatives.map((n) => n.key)).toContain("risk");
    expect(r.negatives[0]!.text).toMatch(/\/10/);
    const adv = statAdvice(r, "BEGINNER");
    expect(adv.length).toBeGreaterThan(0);
    expect(adv.length).toBeLessThanOrEqual(3);
    expect(adv.find((a) => a.key === "risk")?.videoCheck).toMatch(/pas des erreurs/);
  });

  it("gère une durée nulle sans planter", () => {
    expect(computeScore({ ...full, durationSec: 0 }).overall).toBeNull();
  });

  it("a des pondérations qui somment à 1 pour chaque rôle", () => {
    for (const w of Object.values(SCORE_V1.weights)) {
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });
});

describe("progression personnelle", () => {
  it("exige un historique minimal", () => {
    expect(computeProgression(6, [5, 6])).toMatchObject({ available: false, sample: 2 });
  });
  it("compare à la moyenne personnelle", () => {
    expect(computeProgression(7, [5, 6, 5.5, 5.5])).toMatchObject({ available: true, baseline: 5.5, delta: 1.5, trend: "up" });
    expect(computeProgression(5.6, [5.5, 5.5, 5.5])).toMatchObject({ trend: "stable" });
  });
});

describe("MVP entre amis", () => {
  const comp = (scores: Partial<Record<string, number>>) =>
    (["resources", "participation", "damage", "risk", "vision", "objectives"] as const).map((key) => ({
      key,
      score: scores[key] ?? 5,
      available: scores[key] !== -1,
    }));
  const e = (userId: string, overall: number | null, scores: Partial<Record<string, number>> = {}, progressionDelta?: number): MvpEntry => ({
    userId,
    displayName: userId,
    overall,
    components: comp(scores),
    progressionDelta,
  });

  it("désigne un MVP unique et explique pourquoi", () => {
    const r = computeTeamMvp([e("ana", 7.4, { vision: 9 }), e("bob", 6.1), e("cy", 5.0)]);
    expect(r.mvpUserIds).toEqual(["ana"]);
    expect(r.isTie).toBe(false);
    expect(r.explanation).toMatch(/ana/);
    expect(r.explanation).toMatch(/1\.3 point/);
  });

  it("déclare une égalité quand l'écart est sous le seuil", () => {
    const r = computeTeamMvp([e("ana", 7.0), e("bob", 6.8), e("cy", 5.0)]);
    expect(r.isTie).toBe(true);
    expect(r.mvpUserIds.sort()).toEqual(["ana", "bob"]);
    expect(r.explanation).toMatch(/Égalité/);
  });

  it("signale un écart faible sans égalité", () => {
    const r = computeTeamMvp([e("ana", 7.0), e("bob", 6.5)]);
    expect(r.isTie).toBe(false);
    expect(r.explanation).toMatch(/prudence/);
  });

  it("exclut les membres sans note comparable", () => {
    const r = computeTeamMvp([e("ana", 7.0), e("bob", null)]);
    expect(r.excluded.map((x) => x.userId)).toEqual(["bob"]);
    expect(r.mvpUserIds).toEqual(["ana"]);
  });

  it("n'attribue pas de MVP de groupe à un joueur seul", () => {
    expect(computeTeamMvp([e("ana", 7.0)]).mvpUserIds).toEqual([]);
  });

  it("attribue des distinctions seulement avec une avance nette et des données complètes", () => {
    const r = computeTeamMvp([e("ana", 7.0, { vision: 9, objectives: 6 }), e("bob", 6.0, { vision: 5, objectives: 6.5 }, 1.2), e("cy", 5.0, {}, 0.1)]);
    expect(r.distinctions.find((d) => d.key === "vision")?.userId).toBe("ana");
    expect(r.distinctions.find((d) => d.key === "objectives")).toBeUndefined(); // écart < 1
    expect(r.distinctions.find((d) => d.key === "progression")?.userId).toBe("bob");
    const noVision = computeTeamMvp([e("ana", 7.0, { vision: 9 }), e("bob", 6.0, { vision: -1 })]);
    expect(noVision.distinctions.find((d) => d.key === "vision")).toBeUndefined();
  });

  it("ne produit jamais de distinction négative", () => {
    const r = computeTeamMvp([e("ana", 9), e("bob", 2, { risk: 0, vision: 0 })]);
    expect(r.distinctions.every((d) => d.userId === "ana")).toBe(true);
  });
});
