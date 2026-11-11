import { describe, expect, it } from "vitest";
import { nextRankPlan, nextTier, targetFor } from "@/lib/nextRank";

describe("plan pour le rang suivant", () => {
  it("vise le palier au-dessus, Argent par défaut", () => {
    expect(nextTier("GOLD")).toBe("PLATINUM");
    expect(nextTier("CHALLENGER")).toBe("CHALLENGER");
    expect(nextTier(null)).toBe("SILVER");
  });
  it("trie les dimensions par écart au repère, chaque point avec conseils et gestes souris", () => {
    const plan = nextRankPlan([{ key: "vision", avg: 3 }, { key: "resources", avg: 7 }, { key: "risk", avg: 5 }], "PLATINUM");
    expect(plan[0]).toMatchObject({ key: "vision", now: 3, target: 6, gap: 3 });
    expect(plan[1]!.key).toBe("risk");
    expect(plan[1]!.target).toBe(targetFor("PLATINUM", "risk"));
    expect(plan.find((p) => p.key === "resources")!.gap).toBe(-1);
    expect(plan.every((p) => p.tips.length >= 2 && p.mouse.length >= 1)).toBe(true);
    expect(plan.at(-1)!.now).toBeNull(); // dimensions non mesurées en dernier
  });
});
