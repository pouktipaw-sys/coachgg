// Horloge de jeu commune à plusieurs vidéos d'un même match.
// Chaque vidéo synchronisée connaît le temps vidéo (ms) correspondant à 00:00 en jeu
// (gameStartOffsetMs). Temps vidéo = temps de jeu + décalage.

export type SyncTrack = { id: string; gameStartOffsetMs: number; durationMs: number };

/** Position à donner à une vidéo pour un temps de jeu ; inRange=false si la vidéo ne couvre pas cet instant. */
export function videoPositionFor(gameMs: number, track: SyncTrack): { videoMs: number; inRange: boolean } {
  const videoMs = gameMs + track.gameStartOffsetMs;
  if (videoMs < 0) return { videoMs: 0, inRange: false };
  if (videoMs > track.durationMs) return { videoMs: track.durationMs, inRange: false };
  return { videoMs, inRange: true };
}

/** Intervalle de temps de jeu couvert par au moins une vidéo. */
export function gameRange(tracks: SyncTrack[]): { startMs: number; endMs: number } | null {
  if (!tracks.length) return null;
  return {
    startMs: Math.min(...tracks.map((t) => -t.gameStartOffsetMs)),
    endMs: Math.max(...tracks.map((t) => t.durationMs - t.gameStartOffsetMs)),
  };
}

/** Faut-il recaler une vidéo ? (dérive au-delà du seuil, en ms) */
export function needsResync(actualVideoMs: number, expectedVideoMs: number, thresholdMs = 250): boolean {
  return Math.abs(actualVideoMs - expectedVideoMs) > thresholdMs;
}
