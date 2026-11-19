// Liaison et synchronisation automatiques d'une vidéo avec sa partie Riot (fonctions pures, testées).
// • Date d'enregistrement lue dans le nom du fichier (client LoL, OBS, Outplayed, ShadowPlay…).
// • Décalage vidéo ↔ horloge du jeu trouvé en alignant les morts vues à l'image (écran grisé)
//   sur les morts réelles de la timeline : il faut au moins 2 concordances pour l'accepter.

/** « 2024-09-18 19-24-33 », « 2024.09.18-19.24.33 », « 20240918_192433 »… → date locale, ou null. */
export function parseRecordingDate(name: string): Date | null {
  const m =
    /(20\d{2})[-._ ]?([01]\d)[-._ ]?([0-3]\d)[ _T.-]+([0-2]\d)[-_.:h]?([0-5]\d)[-_.:m]?([0-5]\d)?/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31 || h! > 23) return null;
  const date = new Date(y!, mo! - 1, d!, h!, mi!, s ?? 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Partie dont le déroulement (± 10 min) contient l'heure d'enregistrement ; la plus proche si plusieurs. */
export function pickMatch<T extends { id: string; startAt: Date; durationSec: number }>(matches: T[], recordedAt: Date): T | null {
  const t = recordedAt.getTime();
  const margin = 10 * 60_000;
  const fits = matches.filter((m) => t >= m.startAt.getTime() - margin && t <= m.startAt.getTime() + m.durationSec * 1000 + margin);
  return fits.sort((a, b) => Math.abs(a.startAt.getTime() - t) - Math.abs(b.startAt.getTime() - t))[0] ?? null;
}

/** Concordance d'un décalage donné : morts appariées à ±tol ms et écart moyen (ms). */
export function checkOffset(videoDeathsMs: number[], gameDeathsMs: number[], offsetMs: number, tolMs = 1500) {
  const used = new Set<number>();
  const diffs: number[] = [];
  for (const v of videoDeathsMs) {
    let bi = -1;
    for (let i = 0; i < gameDeathsMs.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(v - (gameDeathsMs[i]! + offsetMs));
      if (d <= tolMs && (bi < 0 || d < Math.abs(v - (gameDeathsMs[bi]! + offsetMs)))) bi = i;
    }
    if (bi >= 0) {
      used.add(bi);
      diffs.push(v - (gameDeathsMs[bi]! + offsetMs));
    }
  }
  const residualMs = diffs.length ? Math.round(diffs.reduce((a, b) => a + Math.abs(b), 0) / diffs.length) : null;
  return { matches: diffs.length, residualMs, meanDiffMs: diffs.length ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : 0 };
}

/**
 * Décalage (temps vidéo − temps de jeu) qui aligne le plus de morts à ±tol ms ; à égalité, le plus précis.
 * Affiné par la moyenne des écarts. Au moins 2 concordances, sinon null.
 * Ambigu (un autre décalage, à plus de 3 s, aligne autant de morts) : null — mieux vaut ne pas synchroniser.
 */
export function alignOffset(videoDeathsMs: number[], gameDeathsMs: number[], tolMs = 1500): { offsetMs: number; matches: number; residualMs: number } | null {
  let best: { offsetMs: number; matches: number; residualMs: number } | null = null;
  const all: { offsetMs: number; matches: number }[] = [];
  for (const v of videoDeathsMs)
    for (const g of gameDeathsMs) {
      const first = checkOffset(videoDeathsMs, gameDeathsMs, v - g, tolMs);
      if (first.matches < 2) continue;
      const offsetMs = v - g + first.meanDiffMs; // affinage
      const c = checkOffset(videoDeathsMs, gameDeathsMs, offsetMs, tolMs);
      const cand = { offsetMs, matches: c.matches, residualMs: c.residualMs ?? 0 };
      all.push(cand);
      if (!best || cand.matches > best.matches || (cand.matches === best.matches && cand.residualMs < best.residualMs)) best = cand;
    }
  if (best && all.some((c) => c.matches === best!.matches && Math.abs(c.offsetMs - best!.offsetMs) > 3000)) return null;
  return best;
}
