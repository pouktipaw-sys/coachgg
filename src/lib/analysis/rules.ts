// Règles de l'analyse assistée (version auto-0.1.0) — fonctions pures, testées.
//
// Entrée : signaux MESURÉS par analysis/analyze.py (désaturation, mouvement,
// marqueurs rouges de la minimap). Sortie : propositions de moments à VALIDER.
//
// Garde-fous :
//  • Observations = uniquement des mesures, avec horodatage ; aucune mesure
//    postérieure à l'instant de décision n'est utilisée pour juger la décision.
//  • Une mort probable n'est jamais classée « erreur ».
//  • Pas d'alternative sans signal qui la justifie ; confiance jamais « élevée ».
//  • Toute proposition est créée en brouillon (revue humaine obligatoire).
import { z } from "zod";
import { formatMs, gameTimeMs } from "@/lib/annotations/coaching";
import type { AnnotationInput, RecommendationInput } from "@/lib/annotations/schema";

export const RULES_VERSION = "auto-0.1.0";

const minimapSchema = z
  .object({
    baseline: z.number(),
    peak: z.number(),
    rise: z.number(),
    peakMs: z.number().int(),
    centroid: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
  })
  .nullable();

export const analysisOutputSchema = z.object({
  version: z.string(),
  sampling: z.object({ fps: z.number(), frames: z.number().int(), width: z.number().int() }),
  baselines: z.object({ saturation: z.number(), motionMedian: z.number(), minimap: z.boolean() }),
  events: z
    .array(
      z.object({
        type: z.enum(["grey_screen", "high_activity"]),
        startMs: z.number().int().min(0),
        endMs: z.number().int().min(0),
        confidence: z.enum(["LOW", "MEDIUM"]),
        metrics: z.record(z.number()),
        context: z.object({
          fromMs: z.number().int().min(0),
          toMs: z.number().int().min(0),
          motionMean: z.number().nullable().optional(),
          motionRatioToMedian: z.number().nullable().optional(),
          minimap: minimapSchema.optional(),
        }),
        sheet: z.string().regex(/^[\w.-]+\.jpg$/).nullable(),
      }),
    )
    .max(50),
  warnings: z.array(z.string()),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export type AnalysisEvent = AnalysisOutput["events"][number];

export type Proposal = {
  recommendation: RecommendationInput;
  annotations: Omit<AnnotationInput, "recommendationId">[];
  evidence: Record<string, unknown>;
  sheet: string | null;
};

export const RED_RISE_MIN = 0.01;

function at(ms: number, offset: number | null) {
  const g = gameTimeMs(ms, offset);
  return g != null && g >= 0 ? `${formatMs(ms)} (jeu ${formatMs(g)})` : formatMs(ms);
}

const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;

function greyProposal(e: AnalysisEvent, offset: number | null, durationMs: number): Proposal | null {
  const start = e.startMs;
  if (start < 2500) return null; // pas assez de contexte avant l'événement
  const contextStartMs = Math.max(0, Math.min(e.context.fromMs, start - 2500));
  const decisionMs = start - 2000;
  const slowdownStartMs = Math.max(contextStartMs, start - 4500);
  const endMs = Math.min(durationMs, Math.max(start + 1000, Math.min(e.endMs, start + 4000)));
  if (endMs <= decisionMs) return null;
  const ctxSec = Math.round((start - contextStartMs) / 1000);
  const mm = e.context.minimap ?? null;
  const rise = mm && mm.rise >= RED_RISE_MIN && mm.peakMs < start ? mm : null;
  const ratio = e.metrics.saturationRatio ?? 0;
  const dur = e.metrics.durationSec ?? (e.endMs - e.startMs) / 1000;

  const observations = [
    `L'image de jeu devient désaturée de ${at(start, offset)} à ${at(e.endMs, offset)} (${dur} s ; saturation à ${Math.round(ratio * 100)} % de la référence de la vidéo). Dans League of Legends, cela correspond habituellement à l'écran de mort.`,
  ];
  const mr = e.context.motionRatioToMedian;
  if (mr != null) {
    observations.push(
      mr >= 1.5
        ? `Activité visuelle élevée dans les ${ctxSec} s précédentes (${mr}× la médiane de la vidéo) : engagement ou déplacement de caméra, non distinguables automatiquement.`
        : mr <= 0.7
          ? `Activité visuelle faible dans les ${ctxSec} s précédentes (${mr}× la médiane de la vidéo).`
          : `Activité visuelle habituelle dans les ${ctxSec} s précédentes (${mr}× la médiane de la vidéo).`,
    );
  }
  if (rise) {
    observations.push(
      `Hausse des marqueurs rouges sur la minimap à ${at(rise.peakMs, offset)}, ${Math.round((start - rise.peakMs) / 100) / 10} s avant l'écran grisé (+${pct(rise.rise)} de la surface). Leur nature (champion ennemi, signal, structure) n'est pas identifiée.`,
    );
  } else if (mm) {
    observations.push(`Pas de hausse notable des marqueurs rouges sur la minimap dans les ${ctxSec} s précédentes.`);
  }

  const interpretation = [
    "Le système détecte une mort probable mais ne peut pas déterminer si la décision était risquée : une mort n'est pas forcément une erreur (échange favorable, objectif, sacrifice utile).",
    "L'instant de pause est placé par défaut 2 s avant l'écran grisé : ajustez-le lors de la validation.",
    rise ? "Des marqueurs rouges sont apparus sur la minimap avant la mort : s'il s'agit d'ennemis visibles, l'information était disponible au moment de décider." : "",
    mm ? "" : "La zone minimap n'étant pas définie, les informations de la minimap n'ont pas été examinées.",
  ]
    .filter(Boolean)
    .join(" ");

  const annotations: Proposal["annotations"] = [
    {
      type: "text",
      style: "neutral",
      space: "FRAME",
      startMs: start,
      endMs: Math.min(durationMs, start + 3000),
      geometry: { at: { x: 0.36, y: 0.1 } },
      label: "Écran grisé : mort probable (auto)",
    },
  ];
  if (rise?.centroid) {
    const from = Math.max(contextStartMs, rise.peakMs - 500);
    annotations.push({
      type: "highlight",
      style: "enemy",
      space: "MINIMAP",
      startMs: from,
      endMs: Math.max(from + 1500, Math.min(start, from + 60_000)),
      geometry: { at: rise.centroid, r: 0.08 },
      label: "Marqueurs rouges (non identifiés)",
    });
  }

  return {
    recommendation: {
      kind: "INTERESTING",
      category: rise ? "VISION" : "ENGAGEMENT",
      title: `Écran grisé à ${formatMs(start)} — mort probable, contexte à revoir`,
      contextStartMs,
      slowdownStartMs,
      decisionMs,
      endMs,
      slowdownRate: 0.5,
      observations,
      interpretation,
      alternatives: rise
        ? [
            {
              label: "Reculer ou se rapprocher des alliés dès l'apparition des marqueurs ennemis sur la minimap",
              conditions: "Si les marqueurs rouges correspondent à des champions ennemis visibles et qu'aucun avantage clair ne justifiait de rester.",
              limits: "Proposition générique issue d'une règle : la nature des marqueurs n'est pas vérifiée et l'issue n'est pas garantie.",
            },
          ]
        : [],
      confidence: rise ? "LOW" : "INCONCLUSIVE",
      confidenceReason: rise
        ? `Mort probable (détection ${e.confidence === "MEDIUM" ? "nette" : "incertaine"}) et hausse de marqueurs rouges mesurée, mais leur nature et la cause de la mort ne sont pas établies.`
        : `Mort probable (détection ${e.confidence === "MEDIUM" ? "nette" : "incertaine"}), mais aucun signal mesuré ne permet d'en établir la cause.`,
      advice: rise ? "Quand des marqueurs ennemis apparaissent près de toi sur la minimap, décide tout de suite : reculer, te regrouper ou engager avec tes alliés." : "",
      clipId: null,
    },
    annotations,
    evidence: { type: e.type, detection: e.confidence, metrics: e.metrics, context: e.context },
    sheet: e.sheet,
  };
}

function activityProposal(e: AnalysisEvent, offset: number | null, durationMs: number): Proposal | null {
  const start = e.startMs;
  if (start < 2500) return null;
  const contextStartMs = Math.max(0, Math.min(e.context.fromMs, start - 2500));
  const slowdownStartMs = Math.max(contextStartMs, start - 2000);
  const decisionMs = start;
  const endMs = Math.min(durationMs, Math.max(start + 1000, Math.min(e.endMs + 2000, start + 15_000)));
  if (endMs <= decisionMs) return null;
  return {
    recommendation: {
      kind: "FIGHT",
      category: "ENGAGEMENT",
      title: `Forte activité à ${formatMs(start)} — engagement probable`,
      contextStartMs,
      slowdownStartMs,
      decisionMs,
      endMs,
      slowdownRate: 0.5,
      observations: [
        `Mouvement de l'image ${e.metrics.ratioToMedian}× supérieur à la médiane de la vidéo de ${at(start, offset)} à ${at(e.endMs, offset)}.`,
        "Ce signal ne distingue pas un combat d'un déplacement rapide de la caméra.",
      ],
      interpretation: "Séquence sélectionnée pour revue (situation potentiellement intéressante, sans mort détectée). Aucune décision n'est évaluée automatiquement.",
      alternatives: [],
      confidence: "INCONCLUSIVE",
      confidenceReason: "Signal de mouvement uniquement ; le contenu de la séquence n'est pas interprété.",
      advice: "",
      clipId: null,
    },
    annotations: [],
    evidence: { type: e.type, metrics: e.metrics, context: e.context },
    sheet: e.sheet,
  };
}

export function buildProposals(out: AnalysisOutput, opts: { durationMs: number; gameStartOffsetMs: number | null }): Proposal[] {
  const res: Proposal[] = [];
  for (const e of out.events) {
    const p = e.type === "grey_screen" ? greyProposal(e, opts.gameStartOffsetMs, opts.durationMs) : activityProposal(e, opts.gameStartOffsetMs, opts.durationMs);
    if (p) res.push(p);
  }
  return res;
}
