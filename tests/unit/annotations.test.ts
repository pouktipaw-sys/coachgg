import { describe, expect, it } from "vitest";
import { annotationInputSchema, recommendationInputSchema } from "@/lib/annotations/schema";
import { contentRect, drawProgress, fadeOpacity, pointAlong, projectPoint, projectRadius, unprojectPoint } from "@/lib/annotations/geometry";
import { crossedDecision, effectiveRate, formatMs, gameTimeMs, nextMoment, parseClock, prevMoment, resetSeenAfterSeek } from "@/lib/annotations/coaching";

describe("schéma d'annotation", () => {
  const base = { startMs: 1000, endMs: 4000, style: "actual" as const };

  it("accepte une trajectoire valide et applique l'espace FRAME par défaut", () => {
    const a = annotationInputSchema.parse({ ...base, type: "path", geometry: { points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.5 }] } });
    expect(a.space).toBe("FRAME");
  });

  it("refuse des coordonnées hors [0,1]", () => {
    expect(() => annotationInputSchema.parse({ ...base, type: "marker", geometry: { at: { x: 1.2, y: 0.5 } } })).toThrow();
  });

  it("refuse une fin avant le début et une durée > 60 s", () => {
    expect(() => annotationInputSchema.parse({ ...base, endMs: 500, type: "marker", geometry: { at: { x: 0.2, y: 0.5 } } })).toThrow(/suivre/);
    expect(() => annotationInputSchema.parse({ ...base, endMs: 70_000, type: "marker", geometry: { at: { x: 0.2, y: 0.5 } } })).toThrow(/60/);
  });

  it("refuse une géométrie qui ne correspond pas au type", () => {
    expect(() => annotationInputSchema.parse({ ...base, type: "arrow", geometry: { points: [] } })).toThrow();
  });

  it("exige un texte pour le type text", () => {
    expect(() => annotationInputSchema.parse({ ...base, type: "text", geometry: { at: { x: 0.2, y: 0.5 } } })).toThrow(/texte/);
  });
});

describe("schéma de moment de coaching", () => {
  const ok = {
    kind: "MISTAKE",
    category: "POSITIONING",
    title: "Avancée sans vision",
    contextStartMs: 1000,
    slowdownStartMs: 4000,
    decisionMs: 6000,
    endMs: 9000,
    observations: ["Aucun ennemi visible"],
    alternatives: [{ label: "Rester derrière la vague" }],
    confidence: "MEDIUM",
    confidenceReason: "Position adverse inconnue",
  };

  it("accepte un moment cohérent", () => {
    expect(recommendationInputSchema.parse(ok).slowdownRate).toBe(0.5);
  });

  it("exige l'ordre contexte ≤ ralenti ≤ décision < fin", () => {
    expect(() => recommendationInputSchema.parse({ ...ok, slowdownStartMs: 7000 })).toThrow(/Ordre/);
  });

  it("exige au moins 2 s de contexte avant la décision (pas seulement la frame de l'action)", () => {
    expect(() => recommendationInputSchema.parse({ ...ok, contextStartMs: 5000, slowdownStartMs: 5500 })).toThrow(/contexte/);
  });

  it("exige une alternative pour une erreur, sauf si le contexte ne permet pas de conclure", () => {
    expect(() => recommendationInputSchema.parse({ ...ok, alternatives: [] })).toThrow(/alternative/);
    expect(recommendationInputSchema.parse({ ...ok, alternatives: [], confidence: "INCONCLUSIVE" }).confidence).toBe("INCONCLUSIVE");
  });

  it("autorise une bonne action sans alternative", () => {
    expect(recommendationInputSchema.parse({ ...ok, kind: "GOOD_ACTION", alternatives: [] }).kind).toBe("GOOD_ACTION");
  });
});

describe("géométrie (redimensionnement, plein écran, letterbox)", () => {
  it("calcule le rectangle de contenu avec bandes noires", () => {
    // conteneur 4:3 avec vidéo 16:9 → bandes en haut/bas
    expect(contentRect(800, 600, 1920, 1080)).toEqual({ x: 0, y: 75, w: 800, h: 450 });
    // conteneur très large → bandes latérales
    expect(contentRect(2000, 450, 1600, 900)).toEqual({ x: 600, y: 0, w: 800, h: 450 });
  });

  it("projette et déprojette un point de manière cohérente quelle que soit la taille", () => {
    for (const [cw, ch] of [[640, 360], [1920, 1080], [1000, 1000]] as const) {
      const frame = contentRect(cw, ch, 1920, 1080);
      const p = projectPoint({ x: 0.25, y: 0.75 }, "FRAME", frame, null);
      expect(unprojectPoint(p.x, p.y, "FRAME", frame, null)).toEqual({ x: 0.25, y: 0.75 });
    }
  });

  it("projette dans la zone minimap", () => {
    const frame = { x: 0, y: 0, w: 1000, h: 500 };
    const mm = { x: 0.8, y: 0.6, w: 0.2, h: 0.4 };
    expect(projectPoint({ x: 0.5, y: 0.5 }, "MINIMAP", frame, mm)).toEqual({ x: 900, y: 400 });
    expect(projectRadius(0.1, "MINIMAP", frame, mm)).toBeCloseTo(20);
    expect(unprojectPoint(100, 100, "MINIMAP", frame, mm)).toBeNull(); // hors minimap
  });

  it("anime en fonction du seul temps vidéo (correct après un seek)", () => {
    const a = { startMs: 1000, endMs: 6000 };
    expect(drawProgress(a, 500)).toBe(0);
    expect(drawProgress(a, 1750)).toBeCloseTo(0.5);
    expect(drawProgress(a, 5000)).toBe(1);
    expect(drawProgress(a, 1750)).toBe(drawProgress(a, 1750)); // déterministe
    expect(fadeOpacity(a, 6100)).toBe(0);
    expect(fadeOpacity(a, 5850)).toBeCloseTo(0.5);
    expect(fadeOpacity(a, 3000)).toBe(1);
  });

  it("trouve un point le long d'une polyligne", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(pointAlong(pts, 0.5)).toEqual({ x: 10, y: 0 });
    expect(pointAlong(pts, 0.75)).toEqual({ x: 10, y: 5 });
    expect(pointAlong(pts, 1)).toEqual({ x: 10, y: 10 });
  });
});

describe("parcours pédagogique", () => {
  const m = { id: "m1", contextStartMs: 2000, slowdownStartMs: 5000, decisionMs: 7000, endMs: 11000, slowdownRate: 0.5 };

  it("ralentit uniquement dans la fenêtre de ralenti", () => {
    expect(effectiveRate([m], 4000, 1, true)).toBe(1);
    expect(effectiveRate([m], 6000, 1, true)).toBe(0.5);
    expect(effectiveRate([m], 6000, 2, true)).toBe(1);
    expect(effectiveRate([m], 6000, 1, false)).toBe(1);
    expect(effectiveRate([m], 7500, 1, true)).toBe(1);
  });

  it("met en pause au franchissement de la décision pendant la lecture continue", () => {
    expect(crossedDecision([m], 6980, 7010, new Set())?.id).toBe("m1");
    expect(crossedDecision([m], 7010, 7040, new Set())).toBeNull();
  });

  it("ne déclenche pas lors d'un saut (seek) par-dessus la décision", () => {
    expect(crossedDecision([m], 1000, 9000, new Set())).toBeNull();
  });

  it("ne redéclenche pas un moment déjà vu, sauf après un retour en arrière", () => {
    const seen = new Set(["m1"]);
    expect(crossedDecision([m], 6980, 7010, seen)).toBeNull();
    resetSeenAfterSeek([m], seen, 3000);
    expect(seen.has("m1")).toBe(false);
    expect(crossedDecision([m], 6980, 7010, seen)?.id).toBe("m1");
  });

  it("navigue entre événements", () => {
    const m2 = { ...m, id: "m2", contextStartMs: 20000, slowdownStartMs: 22000, decisionMs: 24000, endMs: 26000 };
    expect(nextMoment([m, m2], 0)?.id).toBe("m1");
    expect(nextMoment([m, m2], 2500)?.id).toBe("m2");
    expect(prevMoment([m, m2], 25000)?.id).toBe("m2");
    expect(prevMoment([m, m2], 21000)?.id).toBe("m1");
  });

  it("formate et parse les horloges", () => {
    expect(formatMs(65_000)).toBe("1:05");
    expect(formatMs(3_725_000)).toBe("1:02:05");
    expect(parseClock("12:34")).toBe(754_000);
    expect(parseClock("1:02:03")).toBe(3_723_000);
    expect(parseClock("12:75")).toBeNull();
    expect(gameTimeMs(80_000, 20_000)).toBe(60_000);
    expect(gameTimeMs(80_000, null)).toBeNull();
  });
});
