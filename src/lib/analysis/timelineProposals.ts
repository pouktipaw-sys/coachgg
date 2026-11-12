// Transforme une mort réelle (timeline Riot) en moment de coaching : diagnostic chiffré et
// schéma sur la minimap (position de la mort, ennemis, alliés, direction de repli).
import type { Proposal } from "./rules";
import { diagnoseDeath, toMinimap, type DeathFacts } from "@/lib/riot/timelineFacts";

export const TIMELINE_VERSION = "riot-timeline-1.0.0";

export function timelineProposal(f: DeathFacts, opts: { deathVideoMs: number; durationMs: number; contextSec: number; minimap: boolean }): Proposal | null {
  const death = opts.deathVideoMs;
  if (death < 3000 || death > opts.durationMs) return null;
  const dx = diagnoseDeath(f);
  const contextStartMs = Math.max(0, death - opts.contextSec * 1000);
  const decisionMs = Math.max(contextStartMs + 500, death - 2500);
  const slowdownStartMs = Math.max(contextStartMs, decisionMs - 2000);
  const endMs = Math.min(opts.durationMs, death + 3000);
  const win = { startMs: Math.max(0, decisionMs - 1500), endMs: Math.min(opts.durationMs, death + 2500) };
  const annotations: Proposal["annotations"] = [];
  if (opts.minimap) {
    annotations.push({ type: "highlight", style: "danger", space: "MINIMAP", ...win, geometry: { at: toMinimap(f.pos), r: 0.06 }, label: "Lieu de la mort" });
    for (const e of f.enemies) if (e.pos) annotations.push({ type: "highlight", style: "enemy", space: "MINIMAP", ...win, geometry: { at: toMinimap(e.pos), r: 0.04 }, label: e.champion.slice(0, 20) });
    for (const a of f.alliesNear) annotations.push({ type: "highlight", style: "ally", space: "MINIMAP", ...win, geometry: { at: toMinimap(a.pos), r: 0.04 }, label: a.champion.slice(0, 20) });
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
    evidence: { type: "riot_death", deathVideoMs: death, facts: { ...f, enemies: f.enemies.map((e) => e.champion) } },
    sheet: null,
  };
}
