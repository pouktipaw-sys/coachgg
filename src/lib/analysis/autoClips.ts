// Découpage automatique en clips des séquences détectées par l'analyse (fonction pure, testée).
// • Mort probable (écran grisé) → clip « Mort » : contexte avant + quelques secondes après.
// • Forte activité (combat probable) → clip « Engagement », s'il ne recouvre pas déjà une mort.
// Ces clips sont des extraits à revoir : ils ne portent aucun diagnostic.
import { formatMs, gameTimeMs } from "@/lib/annotations/coaching";
import type { AnalysisEvent } from "./rules";

export type AutoClipOptions = { deaths: boolean; fights: boolean; contextSec: number };
export type AutoClip = { kind: "DEATH" | "FIGHT"; title: string; startMs: number; endMs: number; eventMs: number };

export const AUTO_CLIP_AFTER_DEATH_MS = 3000;
export const AUTO_CLIP_FIGHT_BEFORE_MS = 5000;
export const AUTO_CLIP_FIGHT_AFTER_MS = 2000;
export const AUTO_CLIP_MAX_MS = 180_000;

function at(ms: number, offset: number | null) {
  const g = gameTimeMs(ms, offset);
  return g != null && g >= 0 ? `${formatMs(ms)} (jeu ${formatMs(g)})` : formatMs(ms);
}

export function autoClipsFrom(
  events: Pick<AnalysisEvent, "type" | "startMs" | "endMs">[],
  durationMs: number,
  gameStartOffsetMs: number | null,
  opts: AutoClipOptions,
): AutoClip[] {
  const clips: AutoClip[] = [];
  if (opts.deaths) {
    for (const e of events.filter((x) => x.type === "grey_screen")) {
      const startMs = Math.max(0, e.startMs - opts.contextSec * 1000);
      const endMs = Math.min(durationMs, e.startMs + AUTO_CLIP_AFTER_DEATH_MS);
      if (endMs - startMs >= 1000) clips.push({ kind: "DEATH", title: `Mort probable à ${at(e.startMs, gameStartOffsetMs)}`, startMs, endMs, eventMs: e.startMs });
    }
  }
  if (opts.fights) {
    for (const e of events.filter((x) => x.type === "high_activity")) {
      const startMs = Math.max(0, e.startMs - AUTO_CLIP_FIGHT_BEFORE_MS);
      const endMs = Math.min(durationMs, startMs + AUTO_CLIP_MAX_MS, e.endMs + AUTO_CLIP_FIGHT_AFTER_MS);
      if (endMs - startMs < 1000) continue;
      if (clips.some((c) => c.kind === "DEATH" && startMs < c.endMs && endMs > c.startMs)) continue; // déjà couvert par une mort
      clips.push({ kind: "FIGHT", title: `Combat probable à ${at(e.startMs, gameStartOffsetMs)}`, startMs, endMs, eventMs: e.startMs });
    }
  }
  return clips.sort((a, b) => a.startMs - b.startMs);
}
