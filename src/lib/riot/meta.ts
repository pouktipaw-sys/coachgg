// Statistiques « méta » (fonctions pures, testées) : une partie classée → incréments par patch/champion/rôle,
// puis tier list (taux de victoire ajusté à la taille de l'échantillon, taux de sélection et de bannissement).
import type { RiotMatch } from "@/server/riot/client";

/** « 15.20.512.3456 » → « 15.20 ». */
export const patchOf = (gameVersion: string) => gameVersion.split(".").slice(0, 2).join(".");

const ROLES = new Set(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]);

export type MetaRows = {
  patch: string;
  champs: { championId: number; role: string; win: boolean }[];
  bans: number[];
  items: { championId: number; role: string; itemId: number; win: boolean }[];
  runes: { championId: number; role: string; pageKey: string; win: boolean }[];
  matchups: { championId: number; role: string; opponentId: number; win: boolean }[];
};

/** Page de runes complète, sous forme de clé : « principal|secondaire|6 runes|3 fragments ». */
export function runePageKey(perks: NonNullable<RiotMatch["info"]["participants"][number]["perks"]>) {
  const [a, b] = perks.styles;
  if (!a || !b || a.selections.length < 4 || b.selections.length < 2 || !perks.statPerks) return null;
  const sel = [...a.selections, ...b.selections].map((x) => x.perk);
  const sp = perks.statPerks;
  return `${a.style}|${b.style}|${sel.join(",")}|${sp.offense},${sp.flex},${sp.defense}`;
}

export function parseRunePageKey(key: string) {
  const [primary, sub, sel, shards] = key.split("|");
  return { primaryStyleId: Number(primary), subStyleId: Number(sub), selectedPerkIds: [...sel!.split(","), ...shards!.split(",")].map(Number) };
}

/** Une partie classée Faille (5 contre 5, rôles connus) → lignes à additionner. null si inutilisable. */
export function metaRows(m: RiotMatch): MetaRows | null {
  const ps = m.info.participants;
  if (ps.length !== 10 || !ps.every((p) => p.championId && p.teamPosition && ROLES.has(p.teamPosition))) return null;
  // Partie écourtée (abandon avant 15 min) : statistiques faussées, ignorée.
  const durationSec = m.info.gameEndTimestamp ? m.info.gameDuration : Math.round(m.info.gameDuration / 1000);
  if (durationSec < 15 * 60) return null;
  const rows: MetaRows = { patch: patchOf(m.info.gameVersion), champs: [], bans: [], items: [], runes: [], matchups: [] };
  for (const p of ps) {
    const role = p.teamPosition!;
    const base = { championId: p.championId!, role, win: p.win };
    rows.champs.push(base);
    for (const it of new Set([p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((x): x is number => !!x))) rows.items.push({ ...base, itemId: it });
    const key = p.perks ? runePageKey(p.perks) : null;
    if (key) rows.runes.push({ ...base, pageKey: key });
    const opp = ps.find((o) => o.teamId !== p.teamId && o.teamPosition === role);
    if (opp?.championId) rows.matchups.push({ ...base, opponentId: opp.championId });
  }
  rows.bans = [...new Set((m.info.teams ?? []).flatMap((t) => (t.bans ?? []).map((b) => b.championId)).filter((id) => id > 0))];
  return rows;
}

export type TierRow = { championId: number; role: string; games: number; wins: number; winrate: number; pickrate: number; banrate: number; score: number; tier: string };

/**
 * Tier list : taux de victoire « ajusté » (ramené vers 50 % quand l'échantillon est petit : a priori de 150 parties
 * à 50 %, sinon 25 parties à 68 % passent devant 400 parties à 55 %)
 * + petit bonus de popularité. Champions sous `minGames` exclus (pas assez de données pour conclure).
 */
export function tierList(stats: { championId: number; role: string; games: number; wins: number }[], patchGames: number, bans: Map<number, number>, minGames = 20): TierRow[] {
  const rows = stats
    .filter((s) => s.games >= minGames)
    .map((s) => {
      const adjusted = (s.wins + 75) / (s.games + 150);
      const pickrate = patchGames ? s.games / patchGames : 0;
      return {
        championId: s.championId, role: s.role, games: s.games, wins: s.wins,
        winrate: Math.round((s.wins / s.games) * 1000) / 10,
        pickrate: Math.round(pickrate * 1000) / 10,
        banrate: patchGames ? Math.round(((bans.get(s.championId) ?? 0) / patchGames) * 1000) / 10 : 0,
        score: adjusted + Math.min(0.02, pickrate * 0.2),
        tier: "",
      };
    })
    .sort((a, b) => b.score - a.score);
  const n = rows.length;
  rows.forEach((r, i) => {
    const q = n ? i / n : 1;
    r.tier = q < 0.05 ? "S+" : q < 0.15 ? "S" : q < 0.35 ? "A" : q < 0.65 ? "B" : q < 0.85 ? "C" : "D";
  });
  return rows;
}
