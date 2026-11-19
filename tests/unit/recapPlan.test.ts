import { describe, expect, it } from "vitest";
import { planSegments } from "@/lib/analysis/recapPlan";

const m = (id: string, s: number, d: number, e: number) => ({ id, contextStartMs: s, decisionMs: d, endMs: e });

describe("plan du récap", () => {
  const opts = { maxSegmentMs: 45_000, durationMs: 600_000 };
  it("fusionne les moments qui se chevauchent, sans répéter d'images", () => {
    const p = planSegments([m("a", 10_000, 18_000, 25_000), m("b", 20_000, 28_000, 34_000), m("c", 100_000, 108_000, 112_000)], opts);
    expect(p.map((s) => [s.startMs, s.endMs, s.moments.map((x) => x.id).join("")])).toEqual([
      [10_000, 34_000, "ab"],
      [100_000, 112_000, "c"],
    ]);
  });
  it("trop long pour fusionner : le second extrait commence où le premier s'arrête", () => {
    const p = planSegments([m("a", 0, 30_000, 45_000), m("b", 40_000, 80_000, 95_000)], { maxSegmentMs: 45_000, durationMs: 600_000 });
    expect(p.map((s) => [s.startMs, s.endMs])).toEqual([[0, 45_000], [45_000, 85_000]]);
  });
  it("respecte la durée de la vidéo et l'ordre des décisions", () => {
    const p = planSegments([m("b", 500, 9000, 12_000), m("a", 0, 4000, 8000)], { maxSegmentMs: 45_000, durationMs: 10_000 });
    expect(p).toHaveLength(1);
    expect(p[0]!.endMs).toBe(10_000);
    expect(p[0]!.moments.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
