import { describe, expect, it } from "vitest";
import { aggregate, deathsFromTimeline, evaluateDetections } from "@/lib/analysis/evaluation";

describe("évaluation de l'analyse contre une vérité terrain", () => {
  it("calcule précision, rappel, F1 et décalage moyen", () => {
    const r = evaluateDetections(
      [{ startMs: 13_200 }, { startMs: 40_000 }, { startMs: 90_500 }],
      [{ videoMs: 13_000 }, { videoMs: 90_000 }, { videoMs: 120_000 }],
    );
    expect(r).toMatchObject({ tp: 2, fp: 1, fn: 1, precision: 0.667, recall: 0.667, f1: 0.667, meanOffsetMs: 350 });
    expect(r.falsePositives).toEqual([40_000]);
    expect(r.missed).toEqual([120_000]);
  });

  it("apparie un pour un : deux détections proches d'une seule mort = 1 VP + 1 FP", () => {
    const r = evaluateDetections([{ startMs: 10_000 }, { startMs: 11_000 }], [{ videoMs: 10_800 }]);
    expect(r).toMatchObject({ tp: 1, fp: 1, fn: 0 });
    expect(r.pairs[0]!.detectionMs).toBe(11_000); // la plus proche
  });

  it("respecte la tolérance et la plage analysée", () => {
    expect(evaluateDetections([{ startMs: 10_000 }], [{ videoMs: 14_000 }]).tp).toBe(0);
    expect(evaluateDetections([{ startMs: 10_000 }], [{ videoMs: 14_000 }], { toleranceMs: 5000 }).tp).toBe(1);
    const r = evaluateDetections([], [{ videoMs: 5_000 }, { videoMs: 50_000 }], { rangeMs: { from: 0, to: 30_000 } });
    expect(r.fn).toBe(1);
  });

  it("renvoie null quand un ratio n'est pas défini (aucune donnée)", () => {
    expect(evaluateDetections([], [])).toMatchObject({ precision: null, recall: null, f1: null, meanOffsetMs: null });
  });

  it("agrège en sommant les comptes (pas de moyenne de ratios)", () => {
    const a = aggregate([
      { tp: 9, fp: 1, fn: 0, meanOffsetMs: 200 },
      { tp: 0, fp: 0, fn: 10, meanOffsetMs: null },
    ]);
    expect(a).toMatchObject({ videos: 2, tp: 9, fp: 1, fn: 10, precision: 0.9, recall: 0.474, meanOffsetMs: 200 });
  });

  it("extrait les morts du joueur depuis la timeline MATCH-V5 en temps vidéo", () => {
    const timeline = {
      metadata: { participants: ["a", "me", "c"] },
      info: {
        frames: [
          { events: [{ type: "CHAMPION_KILL", timestamp: 300_000, victimId: 2 }, { type: "WARD_PLACED", timestamp: 301_000 }] },
          { events: [{ type: "CHAMPION_KILL", timestamp: 600_000, victimId: 1 }, { type: "CHAMPION_KILL", timestamp: 900_000, victimId: 2 }] },
        ],
      },
    };
    expect(deathsFromTimeline(timeline, "me", 45_000)).toEqual([345_000, 945_000]);
    expect(deathsFromTimeline(timeline, "inconnu", 0)).toEqual([]);
  });
});
