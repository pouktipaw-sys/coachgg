import { describe, expect, it } from "vitest";
import { pickMoments, severity } from "@/lib/analysis/severity";

const m = (id: string, decisionMs: number, kind: string, flags: string[] = [], provenance = "AUTOMATIC") => ({ id, decisionMs, kind, provenance, confidence: "MEDIUM", autoEvidence: { flags } });

describe("gravité des moments", () => {
  it("une mort qui coûte un objectif pèse plus qu'un échange", () => {
    expect(severity(m("a", 0, "MISTAKE", ["objective_lost", "isolated"]))).toBeGreaterThan(severity(m("b", 0, "MISTAKE", ["isolated"])));
    expect(severity(m("c", 0, "INTERESTING", ["trade"]))).toBeLessThan(severity(m("d", 0, "INTERESTING")));
    expect(severity(m("e", 0, "INTERESTING", [], "MANUAL"))).toBeGreaterThan(severity(m("f", 0, "MISTAKE")));
  });
  it("garde les plus graves, dans l'ordre chronologique", () => {
    const list = [m("t", 1000, "INTERESTING", ["trade"]), m("o", 5000, "MISTAKE", ["objective_lost"]), m("i", 3000, "MISTAKE", ["isolated", "level"]), m("x", 2000, "INTERESTING")];
    expect(pickMoments(list, 2).map((x) => x.id)).toEqual(["i", "o"]);
    expect(pickMoments(list, 10).map((x) => x.id)).toEqual(["t", "x", "i", "o"]);
  });
});
