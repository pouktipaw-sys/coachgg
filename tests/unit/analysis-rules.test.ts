import { describe, expect, it } from "vitest";
import { analysisOutputSchema, buildProposals, type AnalysisOutput } from "@/lib/analysis/rules";
import { annotationInputSchema, recommendationInputSchema } from "@/lib/annotations/schema";

const base = (events: AnalysisOutput["events"], minimap = true): AnalysisOutput => ({
  version: "auto-0.1.0",
  sampling: { fps: 2, frames: 60, width: 320 },
  baselines: { saturation: 120, motionMedian: 4, minimap },
  events,
  warnings: minimap ? [] : ["Zone minimap non définie"],
});

const grey = (minimap: AnalysisOutput["events"][number]["context"]["minimap"]) => ({
  type: "grey_screen" as const,
  startMs: 13000,
  endMs: 20000,
  confidence: "MEDIUM" as const,
  metrics: { saturationRatio: 0.03, durationSec: 7 },
  context: { fromMs: 3000, toMs: 13000, motionMean: 4, motionRatioToMedian: 1.0, minimap },
  sheet: "sheet_0.jpg",
});

describe("règles d'analyse assistée", () => {
  it("valide la sortie de l'analyseur et refuse un nom de fichier dangereux", () => {
    expect(() => analysisOutputSchema.parse(base([grey(null)]))).not.toThrow();
    expect(() => analysisOutputSchema.parse(base([{ ...grey(null), sheet: "../../etc/passwd" }]))).toThrow();
  });

  it("mort probable sans signal minimap : situation à revoir, sans alternative, « ne permet pas de conclure »", () => {
    const [p] = buildProposals(base([grey(null)], false), { durationMs: 30000, gameStartOffsetMs: null });
    expect(p!.recommendation.kind).toBe("INTERESTING"); // jamais « erreur »
    expect(p!.recommendation.confidence).toBe("INCONCLUSIVE");
    expect(p!.recommendation.alternatives).toEqual([]);
    expect(p!.recommendation.interpretation).toMatch(/pas forcément une erreur/);
    expect(p!.recommendation.interpretation).toMatch(/minimap n'étant pas définie/);
    expect(() => recommendationInputSchema.parse(p!.recommendation)).not.toThrow();
  });

  it("hausse de marqueurs rouges AVANT la mort : alternative conditionnelle, confiance faible, annotation minimap", () => {
    const mm = { baseline: 0, peak: 0.02, rise: 0.02, peakMs: 6500, centroid: { x: 0.68, y: 0.14 } };
    const [p] = buildProposals(base([grey(mm)]), { durationMs: 30000, gameStartOffsetMs: 20000 });
    const r = p!.recommendation;
    expect(r.confidence).toBe("LOW");
    expect(r.category).toBe("VISION");
    expect(r.alternatives[0]!.limits).toMatch(/pas vérifiée/);
    expect(r.observations.join(" ")).toMatch(/6,5 s avant|6.5 s avant/);
    expect(r.observations[0]).toMatch(/jeu -?0:0/); // temps de jeu affiché si synchronisé (ici avant 00:00 → masqué ou 0:00)
    expect(r.decisionMs).toBeLessThan(13000);
    expect(r.decisionMs - r.contextStartMs).toBeGreaterThanOrEqual(2000);
    const hl = p!.annotations.find((a) => a.type === "highlight")!;
    expect(hl.space).toBe("MINIMAP");
    expect(hl.endMs).toBeLessThanOrEqual(13000); // pas d'information postérieure à l'événement
    for (const a of p!.annotations) expect(() => annotationInputSchema.parse(a)).not.toThrow();
  });

  it("ignore une hausse mesurée après l'événement", () => {
    const mm = { baseline: 0, peak: 0.05, rise: 0.05, peakMs: 14000, centroid: { x: 0.5, y: 0.5 } };
    const [p] = buildProposals(base([grey(mm)]), { durationMs: 30000, gameStartOffsetMs: null });
    expect(p!.recommendation.alternatives).toEqual([]);
    expect(p!.recommendation.confidence).toBe("INCONCLUSIVE");
  });

  it("forte activité : engagement probable, aucune décision évaluée", () => {
    const [p] = buildProposals(
      base([{ type: "high_activity", startMs: 8000, endMs: 11000, confidence: "LOW", metrics: { motionMean: 12, ratioToMedian: 3 }, context: { fromMs: 0, toMs: 8000 }, sheet: null }]),
      { durationMs: 30000, gameStartOffsetMs: null },
    );
    expect(p!.recommendation.kind).toBe("FIGHT");
    expect(p!.recommendation.confidence).toBe("INCONCLUSIVE");
    expect(p!.recommendation.observations[1]).toMatch(/caméra/);
    expect(() => recommendationInputSchema.parse(p!.recommendation)).not.toThrow();
  });

  it("écarte un événement sans contexte suffisant (début de vidéo)", () => {
    expect(buildProposals(base([{ ...grey(null), startMs: 1000, endMs: 6000 }]), { durationMs: 30000, gameStartOffsetMs: null })).toEqual([]);
  });
});

import { guardReview } from "@/server/analysis/ai";

describe("garde-fous de l'IA", () => {
  const review = (evidence: { claim: string; source: string }[], confidence: "LOW" | "MEDIUM" = "MEDIUM") =>
    ({ evidence, confidence, causes: ["a", "b", "c", "d"], uncertainties: [] }) as never;
  it("rejette les preuves qui citent une image inexistante et abaisse la confiance sans 2 preuves", () => {
    const g = guardReview(review([{ claim: "x", source: "Image 2" }, { claim: "y", source: "image 12" }, { claim: "z", source: "minimap" }]), 6, false);
    expect(g.evidence.map((e) => e.source)).toEqual(["image 2"]);
    expect(g.rejected).toBe(2); // image 12 et minimap absente
    expect(g.confidence).toBe("LOW");
    expect(g.causes).toHaveLength(3);
    expect(guardReview(review([{ claim: "x", source: "image 1" }, { claim: "y", source: "faits" }]), 6, false).confidence).toBe("MEDIUM");
  });
});

import { gameReportRules, recurringPatterns } from "@/server/analysis/ai";

describe("bilan expert : erreurs récurrentes", () => {
  const m = (flags: string[], category = "POSITIONING") => ({ title: "Mort", kind: "MISTAKE", category, advice: "", decisionMs: 1000, automatic: true, flags });
  it("repère les facteurs présents dans au moins 2 moments, du plus fréquent au moins fréquent", () => {
    const r = recurringPatterns([m(["isolated", "gold"]), m(["isolated"]), m(["gold", "isolated"]), m(["level"])]);
    expect(r.map((x) => [x.flag, x.n])).toEqual([["isolated", 3], ["gold", 2]]);
  });
  it("la priorité n°1 du bilan traite l'erreur la plus récurrente", () => {
    const rep = gameReportRules([m(["level"], "ENGAGEMENT"), m(["blind"], "VISION"), m(["blind"], "VISION"), m(["blind"], "VISION")]);
    expect(rep.patterns[0]).toBe("3 morts sans balise dans la moitié adverse");
    expect(rep.priorities[0]!.title).toBe("Vision et minimap");
    expect(rep.priorities[0]!.why).toMatch(/Erreur récurrente mesurée/);
    expect(rep.summary).toMatch(/Erreur qui revient le plus : 3 morts sans balise/);
  });
});

describe("bilan sans aucun moment", () => {
  it("n'invente pas de conseils : explique pourquoi et quoi faire", async () => {
    const { gameReportRules } = await import("@/server/analysis/ai");
    const r = gameReportRules([], { linked: false, minimap: false, videoMs: 31_000 });
    expect(r.summary).toMatch(/n'est liée à aucune partie Riot.*31 s.*minimap/);
    expect(r.priorities.map((p) => p.title)).toEqual(["Lier la vidéo à ta partie", "Importer la partie entière", "Régler la minimap"]);
    expect(r.summary).not.toMatch(/Point général/);
    expect(gameReportRules([], { linked: true, minimap: true, videoMs: 1_800_000 }).priorities).toEqual([]);
  });
});
