// Statistiques calculées sur des parties RÉELLES (fonctions pures, testées) : résumé, par champion, par rôle,
// par adversaire de voie, et « builds qui marchent pour toi » (objets finis et rune clé, avec leur taux de victoire).
// Petit échantillon = résultat signalé comme tel (n affiché partout) : jamais de pourcentage sans le nombre de parties.

export type GameRow = {
  win: boolean;
  championName: string;
  role?: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  cs: number | null;
  durationSec: number;
  items?: number[];
  keystone?: number | null;
  opponent?: string | null; // champion de l'adversaire direct (même rôle, autre équipe)
  date?: Date | string;
};

export type Summary = { games: number; wins: number; winrate: number | null; kda: number | null; csMin: number | null; killsAvg: number | null; deathsAvg: number | null; assistsAvg: number | null };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(games: GameRow[]): Summary {
  const k = games.filter((g) => g.kills != null && g.deaths != null && g.assists != null);
  const c = games.filter((g) => g.cs != null && g.durationSec > 0);
  const wins = games.filter((g) => g.win).length;
  return {
    games: games.length,
    wins,
    winrate: games.length ? Math.round((wins / games.length) * 100) : null,
    // KDA global (somme des éliminations + assistances / somme des morts), comme les sites de stats
    kda: k.length ? Math.round(((k.reduce((a, g) => a + g.kills! + g.assists!, 0)) / Math.max(1, k.reduce((a, g) => a + g.deaths!, 0))) * 100) / 100 : null,
    csMin: c.length ? Math.round((avg(c.map((g) => g.cs! / (g.durationSec / 60)))! ) * 10) / 10 : null,
    killsAvg: k.length ? Math.round(avg(k.map((g) => g.kills!))! * 10) / 10 : null,
    deathsAvg: k.length ? Math.round(avg(k.map((g) => g.deaths!))! * 10) / 10 : null,
    assistsAvg: k.length ? Math.round(avg(k.map((g) => g.assists!))! * 10) / 10 : null,
  };
}

function groupBy(games: GameRow[], key: (g: GameRow) => string | null | undefined) {
  const m = new Map<string, GameRow[]>();
  for (const g of games) {
    const k = key(g);
    if (!k) continue;
    m.set(k, [...(m.get(k) ?? []), g]);
  }
  return [...m.entries()].map(([name, list]) => ({ name, ...summarize(list) })).sort((a, b) => b.games - a.games || (b.winrate ?? 0) - (a.winrate ?? 0));
}

export const byChampion = (games: GameRow[]) => groupBy(games, (g) => g.championName);
export const byRole = (games: GameRow[]) => groupBy(games, (g) => g.role);
/** Adversaires de voie rencontrés au moins `min` fois (sinon le taux de victoire ne veut rien dire). */
export const byOpponent = (games: GameRow[], min = 2) => groupBy(games, (g) => g.opponent).filter((o) => o.games >= min);

export type BuildStat = { id: number; games: number; wins: number; winrate: number };

/**
 * Objets finis et runes clés de TES parties : fréquence et taux de victoire.
 * `finished` dit si un objet est fini (légendaire, bottes évoluées) — les composants sont ignorés.
 */
export function buildStats(games: GameRow[], finished: (itemId: number) => boolean, min = 1) {
  const count = (pick: (g: GameRow) => number[]) => {
    const m = new Map<number, { games: number; wins: number }>();
    for (const g of games) for (const id of new Set(pick(g))) {
      const s = m.get(id) ?? { games: 0, wins: 0 };
      s.games++;
      if (g.win) s.wins++;
      m.set(id, s);
    }
    return [...m.entries()]
      .map(([id, s]) => ({ id, ...s, winrate: Math.round((s.wins / s.games) * 100) }))
      .filter((s) => s.games >= min)
      .sort((a, b) => b.games - a.games || b.winrate - a.winrate);
  };
  return {
    items: count((g) => (g.items ?? []).filter(finished)),
    keystones: count((g) => (g.keystone ? [g.keystone] : [])),
    games: games.filter((g) => (g.items ?? []).some(finished) || g.keystone).length,
  };
}

/** Phrase honnête sur la taille de l'échantillon. */
export function sampleNote(n: number) {
  if (n === 0) return "Aucune partie.";
  if (n < 5) return `Seulement ${n} partie(s) : tendance à confirmer.`;
  if (n < 20) return `${n} parties : échantillon modeste.`;
  return `${n} parties.`;
}
