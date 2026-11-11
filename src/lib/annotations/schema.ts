// Format structuré et validé des annotations vidéo (partagé client/serveur).
//
// Espaces de coordonnées :
//  • FRAME   : coordonnées normalisées [0,1] dans l'image vidéo (espace écran).
//              Ce n'est PAS l'espace du monde 3D : si la caméra bouge, l'annotation
//              ne suit pas la scène. L'éditeur le rappelle ; l'annotation doit donc
//              être courte ou placée pendant une caméra stable.
//  • MINIMAP : coordonnées normalisées [0,1] dans la zone minimap déclarée de la
//              vidéo (Recording.minimapRegion). La minimap est une vue du dessus
//              fixe : c'est l'espace adapté aux trajectoires et rotations.
import { z } from "zod";

export const ANNOTATION_SCHEMA_VERSION = 1;

const unit = z.number().min(0).max(1);
export const pointSchema = z.object({ x: unit, y: unit });
export type Point = z.infer<typeof pointSchema>;

export const ANNOTATION_TYPES = ["path", "arrow", "zone", "marker", "highlight", "click", "text"] as const;
export const ANNOTATION_STYLES = ["actual", "alternative", "danger", "ally", "enemy", "neutral"] as const;
export const COORDINATE_SPACES = ["FRAME", "MINIMAP"] as const;

export type AnnotationType = (typeof ANNOTATION_TYPES)[number];
export type AnnotationStyle = (typeof ANNOTATION_STYLES)[number];
export type CoordinateSpace = (typeof COORDINATE_SPACES)[number];

const radius = z.number().min(0.005).max(0.5);

export const geometrySchemas = {
  path: z.object({ points: z.array(pointSchema).min(2).max(64) }),
  arrow: z.object({ from: pointSchema, to: pointSchema }),
  zone: z.object({ center: pointSchema, r: radius }),
  marker: z.object({ at: pointSchema }),
  highlight: z.object({ at: pointSchema, r: radius }),
  click: z.object({ at: pointSchema }),
  text: z.object({ at: pointSchema }),
} satisfies Record<AnnotationType, z.ZodTypeAny>;

const MAX_MS = 6 * 3600 * 1000;

const base = z.object({
  startMs: z.number().int().min(0).max(MAX_MS),
  endMs: z.number().int().min(0).max(MAX_MS),
  space: z.enum(COORDINATE_SPACES).default("FRAME"),
  style: z.enum(ANNOTATION_STYLES),
  label: z.string().trim().max(80).nullish(),
  recommendationId: z.string().min(1).nullish(),
});

export const annotationInputSchema = z
  .discriminatedUnion("type", [
    base.extend({ type: z.literal("path"), geometry: geometrySchemas.path }),
    base.extend({ type: z.literal("arrow"), geometry: geometrySchemas.arrow }),
    base.extend({ type: z.literal("zone"), geometry: geometrySchemas.zone }),
    base.extend({ type: z.literal("marker"), geometry: geometrySchemas.marker }),
    base.extend({ type: z.literal("highlight"), geometry: geometrySchemas.highlight }),
    base.extend({ type: z.literal("click"), geometry: geometrySchemas.click }),
    base.extend({ type: z.literal("text"), geometry: geometrySchemas.text }),
  ])
  .superRefine((a, ctx) => {
    if (a.endMs <= a.startMs) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endMs"], message: "La fin doit suivre le début." });
    }
    if (a.endMs - a.startMs > 60_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endMs"], message: "Durée maximale : 60 s." });
    }
    if (a.type === "text" && !a.label) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["label"], message: "Un texte est requis." });
    }
  });

export type AnnotationInput = z.infer<typeof annotationInputSchema>;

/** Annotation telle que renvoyée par l'API. */
export type Annotation = AnnotationInput & {
  id: string;
  provenance: "MANUAL" | "AUTOMATIC";
  schemaVersion: number;
};

export const STYLE_META: Record<AnnotationStyle, { label: string; color: string; dash?: string }> = {
  actual: { label: "Trajet réel", color: "#f05252" },
  alternative: { label: "Alternative proposée", color: "#31c48d", dash: "10 7" },
  danger: { label: "Zone dangereuse", color: "#ff8a4c" },
  ally: { label: "Allié", color: "#3f83f8" },
  enemy: { label: "Ennemi visible", color: "#f05252" },
  neutral: { label: "Repère", color: "#e5e7eb" },
};

export const TYPE_META: Record<AnnotationType, { label: string; points: number | "many"; hint: string }> = {
  path: { label: "Trajectoire", points: "many", hint: "Cliquez plusieurs points puis « Terminer »." },
  arrow: { label: "Flèche", points: 2, hint: "Cliquez l'origine puis la pointe." },
  zone: { label: "Zone", points: 2, hint: "Cliquez le centre puis le bord." },
  marker: { label: "Position conseillée", points: 1, hint: "Cliquez la position conseillée." },
  highlight: { label: "Mise en évidence", points: 2, hint: "Cliquez le personnage puis le bord du cercle." },
  click: { label: "Clic conseillé", points: 1, hint: "Cliquez où un clic aurait pu être fait (proposition)." },
  text: { label: "Texte", points: 1, hint: "Cliquez l'emplacement du texte." },
};

// ─────────────────────────── Moments de coaching ───────────────────────────

export const MOMENT_KINDS = ["MISTAKE", "GOOD_ACTION", "OBJECTIVE", "FIGHT", "MISSED_OPPORTUNITY", "INTERESTING", "DEATH"] as const;
export const CATEGORIES = [
  "POSITIONING",
  "MOVEMENT",
  "ENGAGEMENT",
  "ALLY_SUPPORT",
  "RESOURCES",
  "ABILITIES",
  "VISION",
  "ROTATIONS",
  "OBJECTIVES",
  "COORDINATION",
] as const;
export const CONFIDENCES = ["LOW", "MEDIUM", "HIGH", "INCONCLUSIVE"] as const;

export const KIND_LABELS: Record<(typeof MOMENT_KINDS)[number], string> = {
  MISTAKE: "Décision à revoir",
  GOOD_ACTION: "Bonne action",
  OBJECTIVE: "Objectif",
  FIGHT: "Engagement",
  MISSED_OPPORTUNITY: "Occasion manquée",
  INTERESTING: "Situation intéressante",
  DEATH: "Mort",
};

export const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  POSITIONING: "Placement",
  MOVEMENT: "Déplacements",
  ENGAGEMENT: "Engagement / désengagement",
  ALLY_SUPPORT: "Soutien allié",
  RESOURCES: "Gestion des ressources",
  ABILITIES: "Compétences",
  VISION: "Vision",
  ROTATIONS: "Rotations",
  OBJECTIVES: "Objectifs",
  COORDINATION: "Coordination",
};

export const CONFIDENCE_LABELS: Record<(typeof CONFIDENCES)[number], string> = {
  HIGH: "Confiance élevée",
  MEDIUM: "Confiance moyenne",
  LOW: "Confiance faible",
  INCONCLUSIVE: "Le contexte ne permet pas de conclure",
};

export const alternativeSchema = z.object({
  label: z.string().trim().min(1).max(200),
  conditions: z.string().trim().max(400).default(""),
  limits: z.string().trim().max(400).default(""),
});

export const recommendationInputSchema = z
  .object({
    kind: z.enum(MOMENT_KINDS),
    category: z.enum(CATEGORIES),
    title: z.string().trim().min(2).max(120),
    contextStartMs: z.number().int().min(0).max(MAX_MS),
    slowdownStartMs: z.number().int().min(0).max(MAX_MS),
    decisionMs: z.number().int().min(0).max(MAX_MS),
    endMs: z.number().int().min(0).max(MAX_MS),
    slowdownRate: z.number().min(0.1).max(1).default(0.5),
    observations: z.array(z.string().trim().min(1).max(400)).min(1).max(12),
    interpretation: z.string().trim().max(2000).default(""),
    alternatives: z.array(alternativeSchema).max(5).default([]),
    confidence: z.enum(CONFIDENCES),
    confidenceReason: z.string().trim().min(1).max(600),
    advice: z.string().trim().max(300).default(""),
    clipId: z.string().nullish(),
  })
  .superRefine((r, ctx) => {
    if (!(r.contextStartMs <= r.slowdownStartMs && r.slowdownStartMs <= r.decisionMs && r.decisionMs < r.endMs)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionMs"],
        message: "Ordre attendu : début du contexte ≤ début du ralenti ≤ décision < fin.",
      });
    }
    if (r.decisionMs - r.contextStartMs < 2000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contextStartMs"],
        message: "Examinez au moins 2 s de contexte avant la décision (pas seulement l'instant de l'action).",
      });
    }
    if (r.confidence !== "INCONCLUSIVE" && r.kind === "MISTAKE" && r.alternatives.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["alternatives"],
        message: "Une décision à revoir doit proposer au moins une alternative (ou être marquée « ne permet pas de conclure »).",
      });
    }
  });

export type RecommendationInput = z.infer<typeof recommendationInputSchema>;
