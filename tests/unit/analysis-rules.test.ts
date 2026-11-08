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
