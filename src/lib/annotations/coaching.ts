// Logique pure du parcours pédagogique : ralenti → pause à la décision → relecture.

export type MomentTiming = {
  id: string;
  contextStartMs: number;
  slowdownStartMs: number;
  decisionMs: number;
  endMs: number;
  slowdownRate: number;
};

/** Vitesse effective : la vitesse choisie, réduite pendant la fenêtre de ralenti. */
export function effectiveRate(moments: MomentTiming[], tMs: number, userRate: number, coachingOn: boolean): number {
  if (!coachingOn) return userRate;
  const m = moments.find((m) => tMs >= m.slowdownStartMs && tMs < m.decisionMs);
  return m ? Math.max(0.1, Math.round(userRate * m.slowdownRate * 100) / 100) : userRate;
}

/**
 * Détecte le franchissement d'un instant de décision pendant une lecture continue.
 * Un saut (seek) ne déclenche rien : la différence entre deux ticks doit rester
 * inférieure à `maxStepMs`. Un moment déjà « vu » pendant ce passage est ignoré.
 */
export function crossedDecision(
  moments: MomentTiming[],
  prevMs: number,
  tMs: number,
  seen: ReadonlySet<string>,
  maxStepMs = 1000,
): MomentTiming | null {
  if (tMs <= prevMs || tMs - prevMs > maxStepMs) return null;
  for (const m of moments) {
    if (!seen.has(m.id) && prevMs < m.decisionMs && m.decisionMs <= tMs) return m;
  }
  return null;
}

/** Après un seek, les moments situés après la nouvelle position redeviennent « à voir ». */
export function resetSeenAfterSeek(moments: MomentTiming[], seen: Set<string>, tMs: number) {
  for (const m of moments) if (m.decisionMs > tMs) seen.delete(m.id);
}

/** Événement précédent/suivant (navigation timeline). */
export function nextMoment(moments: MomentTiming[], tMs: number) {
  return [...moments].sort((a, b) => a.contextStartMs - b.contextStartMs).find((m) => m.contextStartMs > tMs + 250) ?? null;
}

export function prevMoment(moments: MomentTiming[], tMs: number) {
  const sorted = [...moments].sort((a, b) => b.contextStartMs - a.contextStartMs);
  return sorted.find((m) => m.contextStartMs < tMs - 1500) ?? null;
}

export function formatMs(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

/** Temps de jeu affiché à partir du temps vidéo et du décalage de synchronisation. */
export function gameTimeMs(videoMs: number, gameStartOffsetMs: number | null | undefined): number | null {
  if (gameStartOffsetMs == null) return null;
  return videoMs - gameStartOffsetMs;
}

/** Parse « mm:ss » ou « h:mm:ss » → ms. */
export function parseClock(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,3}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (sec >= 60) return null;
  return ((h * 60 + min) * 60 + sec) * 1000;
}
