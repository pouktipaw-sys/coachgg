// Stockage temporaire local avec limite d'espace disque et nettoyage automatique.
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const VIDEO_RE = /\.(mp4|mkv)$/i;

export function usedBytes(dir: string): number {
  mkdirSync(dir, { recursive: true });
  return readdirSync(dir)
    .filter((f) => VIDEO_RE.test(f))
    .reduce((a, f) => a + statSync(path.join(dir, f)).size, 0);
}

/** Espace disponible pour un nouvel enregistrement (avec une réserve de 500 Mo). */
export function availableForRecording(dir: string, limit: number, reserve = 500 * 1024 ** 2) {
  return Math.max(0, limit - usedBytes(dir) - reserve);
}

/**
 * Libère de l'espace en supprimant d'abord les fichiers DÉJÀ envoyés (les plus anciens),
 * jamais ceux qui attendent encore l'envoi.
 */
export function enforceDiskLimit(dir: string, limit: number, uploaded: Set<string>): string[] {
  const files = readdirSync(dir)
    .filter((f) => VIDEO_RE.test(f))
    .map((f) => ({ f, p: path.join(dir, f), st: statSync(path.join(dir, f)) }))
    .sort((a, b) => a.st.mtimeMs - b.st.mtimeMs);
  let total = files.reduce((a, x) => a + x.st.size, 0);
  const removed: string[] = [];
  for (const x of files) {
    if (total <= limit) break;
    if (!uploaded.has(x.p)) continue;
    rmSync(x.p, { force: true });
    total -= x.st.size;
    removed.push(x.p);
  }
  return removed;
}
