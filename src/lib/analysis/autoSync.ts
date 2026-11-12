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

/** Décalage (temps vidéo − temps de jeu) qui aligne le plus de morts, à ±tol ms près. */
export function alignOffset(videoDeathsMs: number[], gameDeathsMs: number[], tolMs = 1500): { offsetMs: number; matches: number } | null {
  let best: { offsetMs: number; matches: number } | null = null;
  for (const v of videoDeathsMs)
    for (const g of gameDeathsMs) {
      const off = v - g;
      const used = new Set<number>();
      let n = 0;
      const pairs: number[] = [];
      for (const vv of videoDeathsMs) {
        const gi = gameDeathsMs.findIndex((gg, i) => !used.has(i) && Math.abs(vv - (gg + off)) <= tolMs);
        if (gi >= 0) {
          used.add(gi);
          n++;
          pairs.push(vv - gameDeathsMs[gi]!);
        }
      }
      const refined = Math.round(pairs.reduce((a, b) => a + b, 0) / pairs.length);
      if (!best || n > best.matches) best = { offsetMs: refined, matches: n };
    }
  return best && best.matches >= 2 ? best : null;
}
