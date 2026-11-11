import { describe, expect, it } from "vitest";
import { classifyGame, impactSummary, type ImpactGame } from "@/lib/impact";

const g = (myScore: number, mates: number[], win = true, i = 0): ImpactGame => ({ matchId: `m${i}`, win, myScore, mateScores: mates, killParticipation: null, mvpVotes: 0 });

describe("porteur ou porté", () => {
  it("classe une partie selon l'écart à la moyenne des coéquipiers", () => {
    expect(classifyGame(g(8, [6, 6, 6, 6]))).toEqual({ kind: "CARRY", gap: 2, rank: 1 });
    expect(classifyGame(g(4, [6, 6, 6, 6]))).toMatchObject({ kind: "CARRIED", rank: 5 });
    expect(classifyGame(g(8, [6, 6], false))!.kind).toBe("FOUGHT");
    expect(classifyGame(g(4, [6, 6], false))!.kind).toBe("STRUGGLED");
    expect(classifyGame(g(6.4, [6, 6]))!.kind).toBe("EVEN");
    expect(classifyGame(g(6, [6]))).toBeNull(); // pas assez de coéquipiers notés
  });

  it("verdict sur l'ensemble, avec les chiffres qui le justifient", () => {
    const carried = impactSummary(Array.from({ length: 6 }, (_, i) => g(4, [6.5, 6, 7, 6], true, i)));
    expect(carried.verdict.kind).toBe("CARRIED");
    expect(carried.verdict.detail).toMatch(/6 de tes 6 victoires/);
    const carry = impactSummary(Array.from({ length: 6 }, (_, i) => g(8.5, [6, 6, 5, 6], i % 2 === 0, i)));
    expect(carry.verdict.kind).toBe("CARRY");
    expect(carry.bestInTeam).toBe(6);
    expect(impactSummary([g(8, [6, 6])]).verdict.kind).toBe("UNKNOWN");
  });
});
