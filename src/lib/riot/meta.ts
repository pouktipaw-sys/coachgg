// Statistiques « méta » (fonctions pures, testées) : une partie classée → incréments par patch/champion/rôle,
// puis tier list (taux de victoire ajusté à la taille de l'échantillon, taux de sélection et de bannissement).
import type { RiotMatch, RiotTimeline } from "@/server/riot/client";

/** Modes collectés : classée solo/duo (par rôle), ARAM et Arena (sans rôle : « ANY »). */
export const META_MODES = { RANKED: 420, ARAM: 450, ARENA: 1700 } as const;
export type MetaMode = keyof typeof META_MODES;
/** Rangs (seau de statistiques) : rang du joueur dont la partie a été collectée. ALL = tous rangs confondus. */
export const META_TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"] as const;
export type MetaTier = (typeof META_TIERS)[number];

/**
 * Clé de stockage (« seau ») : patch + mode + rang + serveur, compatible avec les clés existantes.
 * « 15.20 » = classée, tous rangs, tous serveurs ; « 15.20@ARAM » ; « 15.20~T:GOLD » ; « 15.20~T:GOLD~P:EUW1 ».
 */
export function metaPatchKey(patch: string, mode: MetaMode, tier = "ALL", platform = "ALL") {
  let k = mode === "RANKED" ? patch : `${patch}@${mode}`;
  if (tier !== "ALL") k += `~T:${tier}`;
  if (platform !== "ALL") k += `~P:${platform}`;
  return k;
}
export function parseMetaKey(key: string) {
  const [head, ...rest] = key.split("~");
  const [patch, mode] = head!.split("@");
  const get = (p: string) => rest.find((r) => r.startsWith(p))?.slice(p.length) ?? "ALL";
  return { patch: patch!, mode: (mode === "ARAM" || mode === "ARENA" ? mode : "RANKED") as MetaMode, tier: get("T:"), platform: get("P:") };
}
export const modeOfPatchKey = (key: string): MetaMode => parseMetaKey(key).mode;
export const patchOfKey = (key: string) => parseMetaKey(key).patch;
/** Les 4 seaux d'une partie : global, par rang, par serveur, par rang et serveur. */
export function bucketKeys(baseKey: string, tier: string | null, platform: string) {
  const { patch, mode } = parseMetaKey(baseKey);
  const keys = [metaPatchKey(patch, mode), metaPatchKey(patch, mode, "ALL", platform)];
  if (tier) keys.push(metaPatchKey(patch, mode, tier), metaPatchKey(patch, mode, tier, platform));
  return keys;
}

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
  /** kind : spells, skills, core ; « rune@<adversaire> » et « core@<adversaire> » (build contre un champion) ; « ally:<rôle> » (synergie, key = champion allié). */
  choices: { championId: number; role: string; kind: string; key: string; win: boolean }[];
  players: { puuid: string; riotId: string | null; championId: number; win: boolean }[];
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

/**
 * Une partie → lignes à additionner, ou null si inutilisable.
 * Classée : 10 joueurs aux rôles connus, ≥ 15 min. ARAM : 10 joueurs, ≥ 10 min. Arena : 16 joueurs, victoire = top 4.
 */
export function metaRows(m: RiotMatch, mode: MetaMode = "RANKED"): MetaRows | null {
  const ps = m.info.participants;
  const ranked = mode === "RANKED";
  if (mode === "ARENA" ? ps.length < 16 : ps.length !== 10) return null;
  if (!ps.every((p) => p.championId && (!ranked || (p.teamPosition && ROLES.has(p.teamPosition))))) return null;
  const durationSec = m.info.gameEndTimestamp ? m.info.gameDuration : Math.round(m.info.gameDuration / 1000);
  if (durationSec < (ranked ? 15 : mode === "ARAM" ? 10 : 5) * 60) return null; // abandon : statistiques faussées
  const rows: MetaRows = { patch: metaPatchKey(patchOf(m.info.gameVersion), mode), champs: [], bans: [], items: [], runes: [], matchups: [], choices: [], players: [] };
  for (const p of ps) {
    const role = ranked ? p.teamPosition! : "ANY";
    const win = mode === "ARENA" && p.placement != null ? p.placement <= 4 : p.win;
    const base = { championId: p.championId!, role, win };
    rows.champs.push(base);
    for (const it of new Set([p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((x): x is number => !!x))) rows.items.push({ ...base, itemId: it });
    const key = p.perks ? runePageKey(p.perks) : null;
    if (key) rows.runes.push({ ...base, pageKey: key });
    if (p.summoner1Id && p.summoner2Id) rows.choices.push({ ...base, kind: "spells", key: [p.summoner1Id, p.summoner2Id].sort((a, b) => a - b).join(",") });
    if (ranked) {
      const opp = ps.find((o) => o.teamId !== p.teamId && o.teamPosition === role);
      if (opp?.championId) {
        rows.matchups.push({ ...base, opponentId: opp.championId });
        if (key) rows.choices.push({ ...base, kind: `rune@${opp.championId}`, key });
      }
      for (const a of ps) if (a !== p && a.teamId === p.teamId && a.championId) rows.choices.push({ ...base, kind: `ally:${a.teamPosition}`, key: String(a.championId) });
    }
    if (ranked && p.puuid) rows.players.push({ puuid: p.puuid, riotId: p.riotIdGameName && p.riotIdTagline ? `${p.riotIdGameName}#${p.riotIdTagline}` : null, championId: p.championId!, win });
  }
  rows.bans = [...new Set((m.info.teams ?? []).flatMap((t) => (t.bans ?? []).map((b) => b.championId)).filter((id) => id > 0))];
  return rows;
}

const SKILL = ["", "Q", "W", "E", "R"];

/** Priorité de montée des sorts : ordre dans lequel Q, W et E atteignent 5 points (sinon le plus monté). « Q>E>W ». */
export function skillOrder(slots: number[]): string | null {
  const count: Record<string, number> = { Q: 0, W: 0, E: 0 };
  const maxedAt: Record<string, number> = {};
  slots.forEach((slot, i) => {
    const k = SKILL[slot];
    if (!k || k === "R") return;
    count[k]!++;
    if (count[k] === 5 && maxedAt[k] == null) maxedAt[k] = i;
  });
  if (count.Q! + count.W! + count.E! < 9) return null; // partie trop courte pour juger
  return ["Q", "W", "E"]
    .sort((a, b) => (maxedAt[a] ?? 99) - (maxedAt[b] ?? 99) || count[b]! - count[a]!)
    .join(">");
}

/**
 * Choix tirés de la timeline (une requête de plus par partie) : ordre de montée des sorts et
 * trois premiers objets finis dans l'ordre d'achat. `finished` dit si un objet est fini.
 */
export function timelineChoices(tl: RiotTimeline, m: RiotMatch, mode: MetaMode, finished: (itemId: number) => boolean): MetaRows["choices"] {
  const out: MetaRows["choices"] = [];
  const events = tl.info.frames.flatMap((f) => f.events).sort((a, b) => a.timestamp - b.timestamp);
  m.info.participants.forEach((p, i) => {
    const pid = i + 1;
    if (!p.championId) return;
    const role = mode === "RANKED" ? p.teamPosition || "" : "ANY";
    if (!role) return;
    const win = mode === "ARENA" && p.placement != null ? p.placement <= 4 : p.win;
    const slots = events.filter((e) => e.type === "SKILL_LEVEL_UP" && e.participantId === pid && e.levelUpType !== "EVOLVE").map((e) => e.skillSlot ?? 0);
    const so = skillOrder(slots);
    if (so) out.push({ championId: p.championId, role, kind: "skills", key: so, win });
    const core: number[] = [];
    for (const e of events) {
      if (e.type !== "ITEM_PURCHASED" || e.participantId !== pid || !e.itemId || !finished(e.itemId) || core.includes(e.itemId)) continue;
      core.push(e.itemId);
      if (core.length === 3) break;
    }
    if (core.length === 3) {
      out.push({ championId: p.championId, role, kind: "core", key: core.join(">"), win });
      const opp = mode === "RANKED" ? m.info.participants.find((o) => o.teamId !== p.teamId && o.teamPosition === role) : undefined;
      if (opp?.championId) out.push({ championId: p.championId, role, kind: `core@${opp.championId}`, key: core.join(">"), win });
    }
  });
  return out;
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
