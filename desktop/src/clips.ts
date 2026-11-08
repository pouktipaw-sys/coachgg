// Découpage après match : séquences autour des événements impliquant le joueur.
import { spawn } from "node:child_process";
import type { LiveEvent } from "./liveclient";

export type ClipWindow = { startMs: number; endMs: number; reasons: string[] };

function samePlayer(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const base = (s: string) => s.split("#")[0]!.trim().toLowerCase();
  return a.trim().toLowerCase() === b.trim().toLowerCase() || base(a) === base(b);
}

const OBJECTIVES = new Set(["DragonKill", "BaronKill", "HeraldKill", "TurretKilled", "InhibKilled"]);

/** Événements utiles au coaching : morts, éliminations et assistances du joueur, objectifs qu'il a pris. */
export function relevantEvents(events: LiveEvent[], player: string | null): { gameTimeMs: number; reason: string }[] {
  if (!player) return [];
  const out: { gameTimeMs: number; reason: string }[] = [];
  for (const e of events) {
    if (e.name === "ChampionKill") {
      if (samePlayer(e.victim, player)) out.push({ gameTimeMs: e.gameTimeMs, reason: "mort" });
      else if (samePlayer(e.killer, player)) out.push({ gameTimeMs: e.gameTimeMs, reason: "élimination" });
      else if (e.assisters?.some((a) => samePlayer(a, player))) out.push({ gameTimeMs: e.gameTimeMs, reason: "assistance" });
    } else if (OBJECTIVES.has(e.name) && samePlayer(e.killer, player)) {
      out.push({ gameTimeMs: e.gameTimeMs, reason: "objectif" });
    }
  }
  return out.sort((a, b) => a.gameTimeMs - b.gameTimeMs);
}

/**
 * Fenêtres en temps VIDÉO, fusionnées si elles se chevauchent.
 * `gameStartOffsetMs` = temps vidéo correspondant à 00:00 en jeu.
 */
export function clipWindows(
  events: { gameTimeMs: number; reason: string }[],
  opts: { gameStartOffsetMs: number; durationMs: number; beforeMs: number; afterMs: number },
): ClipWindow[] {
  const raw = events
    .map((e) => {
      const t = e.gameTimeMs + opts.gameStartOffsetMs;
      return { startMs: Math.max(0, t - opts.beforeMs), endMs: Math.min(opts.durationMs, t + opts.afterMs), reasons: [e.reason] };
    })
    .filter((w) => w.endMs - w.startMs >= 2000)
    .sort((a, b) => a.startMs - b.startMs);
  const merged: ClipWindow[] = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (last && w.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, w.endMs);
      last.reasons.push(...w.reasons);
    } else merged.push({ ...w, reasons: [...w.reasons] });
  }
  return merged;
}

/** Extrait une séquence sans réencodage (coupe à l'image clé la plus proche avant le début). */
export function cutClip(input: string, out: string, w: ClipWindow, ffmpeg = "ffmpeg"): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", (w.startMs / 1000).toFixed(3), "-i", input, "-t", ((w.endMs - w.startMs) / 1000).toFixed(3),
      "-c", "copy", "-movflags", "+faststart", out,
    ]);
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`Découpage échoué (code ${c})`))));
  });
}
