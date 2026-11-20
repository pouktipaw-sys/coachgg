// Transforme une mort réelle (timeline Riot) en moment de coaching : diagnostic chiffré et
// schéma sur la minimap (position de la mort, ennemis, alliés, direction de repli).
import type { Proposal } from "./rules";
import { deathFlags, diagnoseDeath, toMinimap, type Absence, type DeathFacts, type Trail } from "@/lib/riot/timelineFacts";

export const TIMELINE_VERSION = "riot-timeline-1.0.0";

/** Trajets estimés → annotations « trajet horodaté » sur la minimap (dessinées au rythme de la vidéo). */
export function trailAnnotations(list: Trail[], durationMs: number): Proposal["annotations"] {
  return list
    .filter((t) => t.times[0]! < durationMs)
    .map((t) => ({
      type: "path" as const,
      style: t.style === "enemy" ? ("enemy" as const) : t.style === "ally" ? ("ally" as const) : ("actual" as const),
      space: "MINIMAP" as const,
      startMs: Math.max(0, t.times[0]!),
      endMs: Math.min(durationMs, t.times.at(-1)! + 3000, t.times[0]! + 60_000),
      geometry: { points: t.points, times: t.times },
      label: t.label.slice(0, 40),
    }));
}

export function timelineProposal(f: DeathFacts, opts: { deathVideoMs: number; durationMs: number; contextSec: number; minimap: boolean; trails?: Trail[] }): Proposal | null {
  const death = opts.deathVideoMs;
  if (death < 3000 || death > opts.durationMs) return null;
  const dx = diagnoseDeath(f);
  const contextStartMs = Math.max(0, death - opts.contextSec * 1000);
  // Instant de décision mesuré (arrivée du premier ennemi à portée), converti en temps vidéo.
  const decisionMs = Math.max(contextStartMs + 500, death - (f.t - f.decision.t));
  const slowdownStartMs = Math.max(contextStartMs, decisionMs - 2000);
  const endMs = Math.min(opts.durationMs, death + 3000);
  const win = { startMs: Math.max(0, decisionMs - 1500), endMs: Math.min(opts.durationMs, death + 2500) };
  const annotations: Proposal["annotations"] = [];
  if (opts.minimap) {
    annotations.push({ type: "highlight", style: "danger", space: "MINIMAP", ...win, geometry: { at: toMinimap(f.pos), r: 0.06 }, label: "Lieu de la mort" });
    for (const e of f.enemies) if (e.pos) annotations.push({ type: "highlight", style: "enemy", space: "MINIMAP", ...win, geometry: { at: toMinimap(e.pos), r: 0.04 }, label: e.champion.slice(0, 20) });
    for (const a of f.alliesNear) annotations.push({ type: "highlight", style: "ally", space: "MINIMAP", ...win, geometry: { at: toMinimap(a.pos), r: 0.04 }, label: a.champion.slice(0, 20) });
    annotations.push(...trailAnnotations(opts.trails ?? [], opts.durationMs));
    if (dx.alternative)
      annotations.push({ type: "arrow", style: "alternative", space: "MINIMAP", startMs: decisionMs, endMs: Math.min(opts.durationMs, death + 2500), geometry: { from: toMinimap(f.pos), to: toMinimap(f.safePoint) }, label: "Repli conseillé" });
  }
  return {
    recommendation: {
      kind: dx.kind,
      category: dx.category,
      title: dx.title.slice(0, 110),
      contextStartMs,
      slowdownStartMs,
      decisionMs,
      endMs,
      slowdownRate: 0.5,
      observations: dx.observations,
      interpretation: dx.interpretation + (opts.minimap ? "" : " (Définis la zone minimap de la vidéo pour voir le schéma des positions.)"),
      alternatives: dx.alternative ? [dx.alternative] : [],
      confidence: "MEDIUM",
      confidenceReason: "Faits mesurés par la timeline Riot (tueur, assistants, objectifs, balises) ; positions des joueurs interpolées entre deux minutes.",
      advice: dx.advice,
      clipId: null,
    },
    annotations,
    evidence: { type: "riot_death", deathVideoMs: death, flags: deathFlags(f), facts: { ...f, enemies: f.enemies.map((e) => e.champion) } },
    sheet: null,
  };
}

/** Moment « absent » (combat perdu ou objectif pris loin de toi) → proposition avec schéma minimap. */
export function absenceProposal(a: Absence, opts: { videoMs: number; durationMs: number; minimap: boolean; trails?: Trail[] }): Proposal | null {
  const v = opts.videoMs;
  if (v < 5000 || v > opts.durationMs) return null;
  const decisionMs = Math.max(1000, v - (a.t - a.departT)); // l'heure de départ nécessaire pour arriver à temps
  const contextStartMs = Math.max(0, decisionMs - 10_000);
  const slowdownStartMs = Math.max(contextStartMs, decisionMs - 2000);
  const endMs = Math.min(opts.durationMs, v + 6000);
  const win = { startMs: Math.max(0, decisionMs - 1500), endMs: Math.min(opts.durationMs, v + 4000) };
  const annotations: Proposal["annotations"] = opts.minimap
    ? [
        { type: "highlight", style: "ally", space: "MINIMAP", ...win, geometry: { at: toMinimap(a.myPos), r: 0.05 }, label: "Toi" },
        { type: "zone", style: "danger", space: "MINIMAP", ...win, geometry: { center: toMinimap(a.where), r: 0.08 }, label: a.kind === "FIGHT" ? "Combat perdu" : "Objectif" },
        { type: "arrow", style: "alternative", space: "MINIMAP", startMs: decisionMs, endMs: win.endMs, geometry: { from: toMinimap(a.myPos), to: toMinimap(a.where) }, label: "Rejoindre" },
        ...trailAnnotations(opts.trails ?? [], opts.durationMs),
      ]
    : [];
  return {
    recommendation: {
      kind: "MISSED_OPPORTUNITY",
      category: "ROTATIONS",
      title: a.title.slice(0, 110),
      contextStartMs,
      slowdownStartMs,
      decisionMs,
      endMs,
      slowdownRate: 0.5,
      observations: a.observations,
      interpretation:
        a.kind === "FIGHT"
          ? "Ton équipe s'est battue sans toi et a perdu nettement : ta présence aurait pu changer le rapport de force. À vérifier : tu faisais peut-être quelque chose d'utile ailleurs (tour, vague importante)."
          : "L'objectif a été pris pendant que tu étais loin. À vérifier : ton équipe a peut-être choisi de le céder.",
      alternatives: [{ label: a.kind === "FIGHT" ? "Rejoindre ton équipe avant le combat" : "Te rapprocher de l'objectif une minute avant", conditions: "si ta vague est poussée et que rien d'important ne te retient ailleurs", limits: "position estimée à partir de la timeline" }],
      confidence: a.estimated ? "LOW" : "MEDIUM",
      confidenceReason: `Combat et objectif mesurés par la timeline Riot ; ta position est estimée${a.estimated ? " loin d'un repère (plus de 30 s)" : ""}.`,
      advice: a.advice,
      clipId: null,
    },
    annotations,
    evidence: { type: "riot_absence", eventVideoMs: v, flags: [a.kind === "FIGHT" ? "absent_fight" : "absent_objective"], absence: { kind: a.kind, distance: a.distance, estimated: a.estimated } },
    sheet: null,
  };
}
