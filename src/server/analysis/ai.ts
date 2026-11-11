// Analyse par IA (Claude, vision) des moments détectés : Claude regarde les images qui précèdent
// chaque mort probable, décrit ce qui est visible, propose une alternative, un conseil et un schéma.
// • Actif uniquement si ANTHROPIC_API_KEY est défini (et ANALYSIS_AI ≠ "off") ; sinon règles seules.
// • Tout reste une PROPOSITION marquée « Analyse IA — à vérifier » (brouillon), jamais un fait établi.
// • Seules des images de la vidéo de l'utilisateur sont envoyées, aucune donnée de compte.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { computeCost } from "../coach/llm";
import { CATEGORIES } from "@/lib/annotations/schema";
import { formatMs, gameTimeMs } from "@/lib/annotations/coaching";
import type { Proposal } from "@/lib/analysis/rules";

export const AI_VERSION = "ia-1.0.0";
export const AI_MAX_MOMENTS = 8; // plafond de coût par vidéo
const FRAMES = 6;

export const aiModel = () => process.env.ANALYSIS_MODEL?.trim() || "claude-opus-5-5";
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY?.trim() && process.env.ANALYSIS_AI !== "off";

/** Sous-ensemble du client Anthropic utilisé (injectable dans les tests). */
export type AiClient = Pick<Anthropic, "beta">;
export const aiDeps = { client: (): AiClient => new Anthropic() };

const P = z.object({ x: z.number(), y: z.number() });
export const MomentReviewSchema = z.object({
  readable: z.boolean().describe("false si les images ne montrent pas clairement une partie de League of Legends"),
  title: z.string().describe("Titre court du moment, ex. « Mort en avançant sans vision dans la jungle adverse »"),
  kind: z.enum(["MISTAKE", "INTERESTING"]).describe("MISTAKE uniquement si une décision évitable est visible"),
  category: z.enum(CATEGORIES),
  observations: z.array(z.string()).describe("2 à 5 faits visibles, chacun préfixé par « Image n : »"),
  interpretation: z.string(),
  alternative: z
    .object({ label: z.string(), conditions: z.string(), limits: z.string() })
    .nullable()
    .describe("Ce qui aurait pu être fait à la place, avec ses conditions et ses limites ; null si rien ne le justifie"),
  advice: z.string().describe("Un conseil concret et court, à la 2e personne"),
  confidence: z.enum(["LOW", "MEDIUM"]),
  confidenceReason: z.string(),
  decisionImage: z.number().int().describe("Numéro de l'image (1..N) où la décision se joue"),
  drawing: z.object({
    actualPath: z.array(P).describe("Trajet réel du champion du joueur sur l'image de décision (0 à 6 points)"),
    saferPath: z.array(P).describe("Trajet conseillé (0 à 4 points), vide s'il n'y a pas d'alternative"),
    saferLabel: z.string().describe("Étiquette du trajet conseillé, 3 à 5 mots"),
    danger: z.object({ x: z.number(), y: z.number(), r: z.number() }).nullable().describe("Zone dangereuse visible, r en fraction de la largeur"),
    enemies: z.array(P).describe("Ennemis visibles sur l'image de décision (5 max)"),
    clicks: z.array(P).describe("Où cliquer (clic droit) pour suivre l'alternative, dans l'ordre (0 à 3 points)"),
  }),
});
export type MomentReview = z.infer<typeof MomentReviewSchema>;

const SYSTEM = `Tu es un coach de League of Legends. Tu analyses des images extraites de l'enregistrement vidéo d'une partie (vue du joueur), prises dans les secondes qui précèdent une mort probable détectée automatiquement (écran grisé).

Règles :
- Décris uniquement ce qui est visible sur les images. N'invente ni champion, ni sort, ni position que tu ne vois pas. Si c'est incertain, dis-le.
- Une mort n'est pas forcément une erreur (échange favorable, objectif, sacrifice utile). Utilise « MISTAKE » seulement si une décision évitable est clairement visible.
- Confiance « MEDIUM » au maximum, « LOW » dès que l'image est ambiguë.
- Coordonnées normalisées sur l'image de décision : (0,0) en haut à gauche, (1,1) en bas à droite. Le champion du joueur est en général au centre de l'écran.
- « clicks » montre le geste à la souris : où le joueur aurait dû faire ses clics droits pour suivre l'alternative (ex. un clic loin derrière, vers la tourelle).
- L'alternative et le conseil doivent être concrets et actionnables (se replacer, attendre la vague, utiliser la minimap, garder un sort de fuite…), en français, au tutoiement, phrases courtes.
- Si les images ne montrent pas clairement une partie (menu, chargement, image illisible) : readable = false et listes de dessin vides.`;

export class AiAnalysisError extends Error {
  constructor(public kind: "refusal" | "rate_limit" | "auth" | "unavailable" | "invalid_output", message: string) {
    super(message);
  }
}

/** Extrait une image JPEG (largeur 768) à un instant donné. */
function grabFrame(ffmpeg: string, video: string, ms: number, out: string) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpeg, ["-v", "error", "-nostdin", "-y", "-ss", (ms / 1000).toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "4", out], { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}`))));
  });
}

/** Instants d'échantillonnage : de la fin du contexte jusqu'à juste avant l'écran grisé. */
export function sampleTimes(contextStartMs: number, deathMs: number, n = FRAMES) {
  const from = Math.max(0, Math.max(contextStartMs, deathMs - 8000));
  const to = Math.max(from, deathMs - 300);
  return Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / Math.max(1, n - 1)));
}

export async function reviewMoment(
  args: { video: string; tmp: string; index: number; contextStartMs: number; deathMs: number; gameStartOffsetMs: number | null; ruleObservations: string[] },
  client: AiClient = new Anthropic(),
) {
  const times = sampleTimes(args.contextStartMs, args.deathMs);
  const images: Buffer[] = [];
  for (const [i, t] of times.entries()) {
    const f = path.join(args.tmp, `ai-${args.index}-${i}.jpg`);
    await grabFrame(process.env.FFMPEG_BIN || "ffmpeg", args.video, t, f);
    images.push(await readFile(f));
  }
  const at = (ms: number) => {
    const g = gameTimeMs(ms, args.gameStartOffsetMs);
    return g != null && g >= 0 ? `${formatMs(ms)} (jeu ${formatMs(g)})` : formatMs(ms);
  };
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `Image ${i + 1} — ${at(times[i]!)}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.toString("base64") } });
  });
  content.push({
    type: "text",
    text: `Écran grisé (mort probable) détecté à ${at(args.deathMs)}.\nMesures automatiques : ${args.ruleObservations.join(" ")}\nAnalyse ce qui a mené à la mort et propose le schéma et le conseil.`,
  });

  let response;
  try {
    response = await client.beta.messages.parse({
      model: aiModel(),
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "medium", format: betaZodOutputFormat(MomentReviewSchema) },
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AiAnalysisError("rate_limit", "Limite de requêtes de l'IA atteinte.");
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiAnalysisError("auth", "Clé API Anthropic invalide ou non autorisée.");
    if (e instanceof Anthropic.APIError) throw new AiAnalysisError("unavailable", `Service d'IA indisponible (${e.status ?? "réseau"}).`);
    throw new AiAnalysisError("unavailable", "Service d'IA injoignable.");
  }
  const costMicros = computeCost(response.model, response.usage) ?? 0;
  if (response.stop_reason === "refusal") throw Object.assign(new AiAnalysisError("refusal", "L'IA a décliné l'analyse de ce moment."), { costMicros });
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw Object.assign(new AiAnalysisError("invalid_output", "Réponse de l'IA incomplète."), { costMicros });
  return { review: response.parsed_output, times, model: response.model, costMicros };
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const cp = (p: { x: number; y: number }) => ({ x: clamp(p.x), y: clamp(p.y) });

/** Remplace une proposition par règles par l'analyse de l'IA (schéma + conseil). */
export function proposalFromReview(base: Proposal, r: MomentReview, times: number[], model: string, durationMs: number): Proposal | null {
  if (!r.readable) return null;
  const idx = Math.min(times.length, Math.max(1, r.decisionImage)) - 1;
  const decisionMs = Math.max(base.recommendation.contextStartMs + 500, Math.min(times[idx]!, base.recommendation.endMs - 500));
  const slowdownStartMs = Math.max(base.recommendation.contextStartMs, decisionMs - 2500);
  const win = (from: number, to: number) => ({ startMs: Math.max(0, from), endMs: Math.min(durationMs, Math.max(from + 500, to)) });
  const d = r.drawing;
  const annotations: Proposal["annotations"] = [];
  if (d.actualPath.length >= 2)
    annotations.push({ type: "path", style: "actual", space: "FRAME", ...win(decisionMs - 1500, decisionMs + 1500), geometry: { points: d.actualPath.slice(0, 6).map(cp) }, label: "Trajet réel" });
  if (d.saferPath.length >= 2)
    annotations.push({ type: "path", style: "alternative", space: "FRAME", ...win(decisionMs, decisionMs + 3000), geometry: { points: d.saferPath.slice(0, 4).map(cp) }, label: (d.saferLabel || "Alternative").slice(0, 40) });
  if (d.danger)
    annotations.push({ type: "zone", style: "danger", space: "FRAME", ...win(decisionMs - 1500, decisionMs + 2000), geometry: { center: cp(d.danger), r: Math.min(0.4, Math.max(0.03, d.danger.r)) }, label: "Zone dangereuse" });
  for (const [k, c] of d.clicks.slice(0, 3).entries())
    annotations.push({ type: "click", style: "alternative", space: "FRAME", ...win(decisionMs + k * 700, decisionMs + 3000), geometry: { at: cp(c) }, label: k === 0 ? "Clic conseillé" : null });
  for (const e of d.enemies.slice(0, 5))
    annotations.push({ type: "highlight", style: "enemy", space: "FRAME", ...win(decisionMs - 1500, decisionMs + 1500), geometry: { at: cp(e), r: 0.04 }, label: "Ennemi" });
  return {
    recommendation: {
      ...base.recommendation,
      kind: r.kind,
      category: r.category,
      title: r.title.slice(0, 110),
      slowdownStartMs,
      decisionMs,
      observations: r.observations.slice(0, 5).map((o) => o.slice(0, 400)),
      interpretation: r.interpretation.slice(0, 1500),
      alternatives: r.alternative ? [r.alternative] : [],
      confidence: r.confidence,
      confidenceReason: r.confidenceReason.slice(0, 500),
      advice: r.advice.slice(0, 500),
    },
    annotations,
    evidence: { ...base.evidence, ai: { version: AI_VERSION, model, frames: times } },
    sheet: base.sheet,
  };
}

// ───────────────────────────── Bilan de la partie ─────────────────────────────

export const GameReportSchema = z.object({
  summary: z.string().describe("2 à 3 phrases : comment s'est passée la partie d'après les moments analysés"),
  patterns: z.array(z.string()).describe("Erreurs récurrentes observées (0 à 3)"),
  priorities: z.array(z.object({ title: z.string(), why: z.string(), drill: z.string() })).describe("Exactement 3 points à travailler, du plus important au moins important"),
  nextGameGoal: z.string().describe("Un objectif mesurable pour la prochaine partie"),
});
export type GameReport = z.infer<typeof GameReportSchema> & { source: "ai" | "rules"; model?: string; moments: number; deaths: number; generatedAt: string };

type MomentLite = { title: string; kind: string; category: string; advice: string; decisionMs: number; automatic: boolean };

const REPORT_SYSTEM = `Tu es un coach de League of Legends. À partir de la liste des moments analysés d'une partie (titres, catégories, conseils, horodatages) et de statistiques éventuelles, rédige un bilan court, bienveillant et concret, en français, au tutoiement. N'invente rien qui ne soit pas dans les données. Les moments marqués « à vérifier » sont des propositions automatiques non confirmées : formule-les avec prudence.`;

export async function gameReportAi(moments: MomentLite[], stats: string | null, client: AiClient = new Anthropic()) {
  const text = [
    `Moments analysés (${moments.length}) :`,
    ...moments.map((m) => `- ${formatMs(m.decisionMs)} · ${m.category} · ${m.title}${m.automatic ? " (à vérifier)" : ""} — conseil : ${m.advice || "—"}`),
    stats ? `Statistiques du match : ${stats}` : "Pas de statistiques de match liées.",
  ].join("\n");
  const response = await client.beta.messages.parse({
    model: aiModel(),
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: REPORT_SYSTEM,
    output_config: { effort: "medium", format: betaZodOutputFormat(GameReportSchema) },
    messages: [{ role: "user", content: text }],
  });
  const costMicros = computeCost(response.model, response.usage) ?? 0;
  if (response.stop_reason !== "end_turn" || !response.parsed_output) throw Object.assign(new AiAnalysisError("invalid_output", "Bilan IA indisponible."), { costMicros });
  return { report: response.parsed_output, model: response.model, costMicros };
}

const CATEGORY_ADVICE: Record<string, { title: string; drill: string }> = {
  VISION: { title: "Vision et minimap", drill: "Regarde la minimap toutes les 5 secondes et pose une balise avant d'entrer dans une zone sombre." },
  POSITIONING: { title: "Placement", drill: "En combat, reste derrière ta ligne de front et garde un sort de fuite disponible." },
  MOVEMENT: { title: "Déplacements", drill: "Avant de traverser la rivière ou la jungle adverse, vérifie où sont les ennemis visibles." },
  ENGAGEMENT: { title: "Choix des combats", drill: "N'engage que si tes alliés sont à portée et que tes sorts principaux sont prêts." },
  ROTATIONS: { title: "Rotations", drill: "Après avoir poussé ta voie, rejoins l'objectif le plus proche plutôt que de rester seul." },
  RESOURCES: { title: "Gestion des ressources", drill: "Rentre à la base avant de manquer de vie ou de mana, pas après une mort." },
  ABILITIES: { title: "Utilisation des sorts", drill: "Garde ton sort de survie pour le moment où tu es ciblé, pas pour infliger des dégâts." },
  ALLY_SUPPORT: { title: "Jeu d'équipe", drill: "Signale tes intentions (ping) avant d'avancer et suis les engagements de tes alliés." },
};

/** Bilan sans IA : construit uniquement à partir des moments enregistrés. */
export function gameReportRules(moments: MomentLite[]): z.infer<typeof GameReportSchema> {
  const deaths = moments.filter((m) => m.kind === "MISTAKE" || /mort/i.test(m.title)).length;
  const counts = new Map<string, number>();
  for (const m of moments) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const order = [...top, ...Object.keys(CATEGORY_ADVICE).filter((c) => !top.includes(c))].filter((c) => CATEGORY_ADVICE[c]).slice(0, 3);
  const priorities = order.map((c) => ({
    title: CATEGORY_ADVICE[c]!.title,
    why: counts.get(c) ? `${counts.get(c)} moment(s) de la partie concernent ce point.` : "Point général, aucun moment détecté ne le concerne directement.",
    drill: CATEGORY_ADVICE[c]!.drill,
  }));
  return {
    summary: moments.length
      ? `${moments.length} moment(s) à revoir dans cette partie, dont ${deaths} mort(s) probable(s). Bilan établi à partir des détections automatiques (sans IA) : revois chaque clip pour confirmer.`
      : "Aucun moment marquant n'a été détecté automatiquement dans cette vidéo.",
    patterns: top.slice(0, 2).filter((c) => (counts.get(c) ?? 0) >= 2).map((c) => `${CATEGORY_ADVICE[c]?.title ?? c} : ${counts.get(c)} moments`),
    priorities,
    nextGameGoal: deaths ? `Finir la prochaine partie avec moins de ${Math.max(1, deaths)} mort(s) évitable(s) en suivant la priorité n°1.` : "Revoir la vidéo de la prochaine partie et marquer toi-même 2 moments à analyser.",
  };
}
