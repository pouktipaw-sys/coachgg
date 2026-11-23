// Exploration de données Riot : recherche de joueur, partie en cours, statistiques avancées.
// • Données publiques de Riot uniquement (comme sur les sites de statistiques), via la clé du serveur.
// • Parties d'autres joueurs mises en cache (RiotMatchCache) pour respecter les limites de requêtes.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, HttpError } from "../errors";
import { RANKED_QUEUES, type RiotClient, type RiotLeagueEntry, type RiotMatch, PLATFORMS, RiotApiError, riotClient } from "./client";
import { ddChampions, ddSummonerSpells, findChampion } from "./ddragon";
import { type GameRow, byChampion, byRole, summarize } from "@/lib/riot/insights";

export function parseRiotId(input: string): { gameName: string; tagLine: string } {
  const m = /^\s*(.{3,16}?)\s*#\s*([A-Za-z0-9]{2,5})\s*$/u.exec(input);
  if (!m) throw badRequest("Riot ID attendu au format Pseudo#TAG (ex. Faker#KR1).");
  return { gameName: m[1]!, tagLine: m[2]! };
}

export function checkPlatform(p: string | undefined) {
  const up = (p ?? "EUW1").toUpperCase();
  if (!(PLATFORMS as readonly string[]).includes(up)) throw badRequest("Serveur inconnu.");
  return up;
}

const client = (c?: RiotClient) => {
  try {
    return c ?? riotClient();
  } catch {
    throw new HttpError(503, "riot_not_configured", "Clé API Riot non configurée sur le serveur : recherche impossible.");
  }
};

function riotError(e: unknown): never {
  if (e instanceof RiotApiError) {
    if (e.status === 404) throw new HttpError(404, "not_found", "Joueur introuvable sur ce serveur (vérifie le Riot ID et le serveur).");
    throw new HttpError(e.status === 429 ? 429 : 502, "riot", e.message);
  }
  throw e;
}

const rank = (entries: RiotLeagueEntry[]) =>
  entries
    .filter((e) => RANKED_QUEUES[e.queueType])
    .map((e) => ({ queue: e.queueType, label: RANKED_QUEUES[e.queueType]!, tier: e.tier, division: e.rank, lp: e.leaguePoints, wins: e.wins, losses: e.losses }));

/** Partie MATCH-V5 depuis le cache, sinon Riot (puis mise en cache). */
async function cachedMatch(c: RiotClient, id: string): Promise<RiotMatch> {
  const hit = await prisma.riotMatchCache.findUnique({ where: { riotMatchId: id } });
  if (hit) return hit.data as unknown as RiotMatch;
  const m = await c.match(id);
  await prisma.riotMatchCache.upsert({ where: { riotMatchId: id }, update: {}, create: { riotMatchId: id, data: m as unknown as Prisma.InputJsonValue } });
  return m;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]!);
    }
  }));
  return out;
}

/** Ligne de partie (point de vue d'un joueur) à partir d'une partie MATCH-V5. */
export function rowFromMatch(m: RiotMatch, puuid: string): (GameRow & { matchId: string; queueId: number; teamKills: number }) | null {
  const me = m.metadata ? m.info.participants.find((p) => p.puuid === puuid) : undefined;
  if (!me) return null;
  const durationSec = m.info.gameEndTimestamp ? m.info.gameDuration : Math.round(m.info.gameDuration / 1000);
  const opp = me.teamPosition ? m.info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition) : undefined;
  return {
    matchId: m.metadata.matchId,
    queueId: m.info.queueId,
    win: me.win,
    championName: me.championName,
    role: me.teamPosition || null,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: me.totalMinionsKilled != null ? me.totalMinionsKilled + (me.neutralMinionsKilled ?? 0) : null,
    durationSec,
    items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5].filter((x): x is number => !!x),
    keystone: me.perks?.styles?.[0]?.selections?.[0]?.perk ?? null,
    opponent: opp?.championName ?? null,
    date: new Date(m.info.gameStartTimestamp ?? m.info.gameCreation),
    teamKills: m.info.participants.filter((p) => p.teamId === me.teamId).reduce((a, p) => a + p.kills, 0),
  };
}

/** Recherche de joueur : profil, rang, champions les plus joués, dernières parties (20 max). */
/** page : 0 = 20 parties les plus récentes, 1 = les 20 suivantes… (jusqu'à 200 parties). */
export async function lookupPlayer(riotId: string, platform: string, opts: { count?: number; page?: number; client?: RiotClient } = {}) {
  const { gameName, tagLine } = parseRiotId(riotId);
  const plat = checkPlatform(platform);
  const c = client(opts.client);
  try {
    const acc = await c.accountByRiotId(gameName, tagLine, plat);
    const [entries, ids, masteries] = await Promise.all([
      c.leagueEntries(acc.puuid, plat),
      c.matchIds(acc.puuid, plat, Math.min(20, opts.count ?? 20), Math.max(0, Math.min(9, opts.page ?? 0)) * Math.min(20, opts.count ?? 20)),
      c.topMasteries(acc.puuid, plat, 5).catch(() => []),
    ]);
    const matches = await pool(ids, 4, (id) => cachedMatch(c, id).catch(() => null));
    const games = matches.map((m) => (m ? rowFromMatch(m, acc.puuid) : null)).filter((g): g is NonNullable<typeof g> => !!g);
    const champs = await ddChampions().catch(() => []);
    return {
      account: { gameName: acc.gameName, tagLine: acc.tagLine, platform: plat },
      page: Math.max(0, Math.min(9, opts.page ?? 0)),
      hasMore: ids.length === Math.min(20, opts.count ?? 20) && (opts.page ?? 0) < 9,
      ranks: rank(entries),
      summary: summarize(games),
      champions: byChampion(games).slice(0, 8),
      roles: byRole(games),
      masteries: masteries.map((x) => ({ championId: x.championId, champion: findChampion(champs, x.championId)?.name ?? `#${x.championId}`, level: x.championLevel, points: x.championPoints })),
      games: games.map((g) => ({ ...g, date: (g.date as Date).toISOString(), kp: g.teamKills ? Math.round(((g.kills ?? 0) + (g.assists ?? 0)) / g.teamKills * 100) : null })),
    };
  } catch (e) {
    riotError(e);
  }
}

/** Partie en cours : 10 joueurs, champion, sorts, rang, maîtrise du champion joué. null si pas en partie. */
export async function liveGame(riotId: string, platform: string, opts: { client?: RiotClient } = {}) {
  const { gameName, tagLine } = parseRiotId(riotId);
  const plat = checkPlatform(platform);
  const c = client(opts.client);
  try {
    const acc = await c.accountByRiotId(gameName, tagLine, plat);
    const g = await c.activeGame(acc.puuid, plat);
    if (!g) return { account: { gameName: acc.gameName, tagLine: acc.tagLine, platform: plat }, game: null };
    const [champs, spells] = await Promise.all([ddChampions().catch(() => []), ddSummonerSpells().catch(() => ({} as Record<string, { name: string; image: string }>))]);
    const players = await pool(g.participants, 4, async (p) => {
      const [entries, mastery] = p.puuid
        ? await Promise.all([c.leagueEntries(p.puuid, plat).catch(() => []), c.championMastery(p.puuid, plat, p.championId).catch(() => null)])
        : [[], null];
      const ch = findChampion(champs, p.championId);
      const solo = rank(entries).find((r) => r.queue === "RANKED_SOLO_5x5") ?? rank(entries)[0] ?? null;
      return {
        riotId: p.riotId ?? null,
        isMe: p.puuid === acc.puuid,
        teamId: p.teamId,
        championId: p.championId,
        champion: ch?.name ?? `#${p.championId}`,
        championImage: ch?.image.full ?? null,
        spells: [p.spell1Id, p.spell2Id].map((id) => spells[String(id)] ?? { name: `Sort ${id}`, image: null }),
        rank: solo,
        winrate: solo && solo.wins + solo.losses > 0 ? Math.round((solo.wins / (solo.wins + solo.losses)) * 100) : null,
        mastery: mastery ? { level: mastery.championLevel, points: mastery.championPoints } : null,
      };
    });
    return {
      account: { gameName: acc.gameName, tagLine: acc.tagLine, platform: plat },
      game: {
        mode: g.gameMode,
        queueId: g.gameQueueConfigId ?? null,
        startedAt: g.gameStartTime ? new Date(g.gameStartTime).toISOString() : null,
        lengthSec: g.gameLength,
        teams: [100, 200].map((t) => ({ teamId: t, players: players.filter((p) => p.teamId === t), bans: (g.bannedChampions ?? []).filter((b) => b.teamId === t && b.championId > 0).map((b) => findChampion(champs, b.championId)?.name ?? `#${b.championId}`) })),
      },
    };
  } catch (e) {
    riotError(e);
  }
}

/** Tes parties réelles (base CoachGG) au format GameRow, avec l'adversaire de voie et les objets/runes. */
export async function userGames(userIds: string[], opts: { champion?: string; mode?: string } = {}): Promise<(GameRow & { userId: string; matchId: string })[]> {
  const parts = await prisma.matchParticipant.findMany({
    where: { userId: { in: userIds }, match: { isDemo: false, ...(opts.mode ? { gameMode: opts.mode } : {}) }, ...(opts.champion ? { championName: { equals: opts.champion, mode: "insensitive" } } : {}) },
    include: {
      statistics: { select: { kills: true, deaths: true, assists: true, creepScore: true, items: true, runes: true } },
      match: { select: { id: true, durationSec: true, gameStartAt: true, createdAt: true, participants: { select: { teamSide: true, role: true, championName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  return parts.map((p) => {
    const opp = p.role ? p.match.participants.find((x) => x.teamSide !== p.teamSide && x.role === p.role) : undefined;
    return {
      userId: p.userId!,
      matchId: p.match.id,
      win: p.win,
      championName: p.championName,
      role: p.role,
      kills: p.statistics?.kills ?? null,
      deaths: p.statistics?.deaths ?? null,
      assists: p.statistics?.assists ?? null,
      cs: p.statistics?.creepScore ?? null,
      durationSec: p.match.durationSec,
      items: p.statistics?.items ?? [],
      keystone: (p.statistics?.runes as { keystone?: number } | null)?.keystone ?? null,
      opponent: opp?.championName ?? null,
      date: p.match.gameStartAt ?? p.match.createdAt,
    };
  });
}

/** Amis acceptés (pour comparer sur un champion). */
export async function friendIds(userId: string) {
  const f = await prisma.friendship.findMany({ where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] }, select: { requesterId: true, addresseeId: true } });
  return f.map((x) => (x.requesterId === userId ? x.addresseeId : x.requesterId));
}

// ───────────── Classement d'un serveur ─────────────

const TIERS = ["challenger", "grandmaster", "master"] as const;
export type ApexTier = (typeof TIERS)[number];
const boardCache = new Map<string, { at: number; value: unknown }>();
const nameCache = new Map<string, { at: number; name: string | null }>();

/** Riot ID d'un PUUID (cache 24 h). */
async function riotIdOf(c: RiotClient, puuid: string, plat: string) {
  const hit = nameCache.get(puuid);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.name;
  const a = await c.accountByPuuid(puuid, plat).catch(() => null);
  const name = a?.gameName && a.tagLine ? `${a.gameName}#${a.tagLine}` : null;
  nameCache.set(puuid, { at: Date.now(), name });
  return name;
}

/**
 * Classement Challenger / Grand maître / Maître d'un serveur (100 premiers), trié par points de ligue.
 * Les Riot ID des `named` premiers sont résolus (1 requête chacun, mis en cache) ; les autres restent consultables.
 */
export async function leaderboard(platform: string, tierIn: string, queue = "RANKED_SOLO_5x5", opts: { client?: RiotClient; named?: number } = {}) {
  const plat = checkPlatform(platform);
  const tier = (TIERS as readonly string[]).includes(tierIn) ? (tierIn as ApexTier) : "challenger";
  const q = queue === "RANKED_FLEX_SR" ? "RANKED_FLEX_SR" : "RANKED_SOLO_5x5";
  const key = `${plat}:${tier}:${q}`;
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000 && !opts.client) return hit.value as Awaited<ReturnType<typeof build>>;
  const c = client(opts.client);
  async function build() {
    const league = await c.apexLeague(tier, q, plat);
    const sorted = [...league.entries].sort((a, b) => b.leaguePoints - a.leaguePoints || b.wins - a.wins).slice(0, 100);
    const named = Math.min(sorted.length, opts.named ?? 25);
    const names = await pool(sorted.slice(0, named), 4, (e) => riotIdOf(c, e.puuid, plat));
    return {
      platform: plat, tier, queue: q, total: league.entries.length, fetchedAt: new Date().toISOString(),
      entries: sorted.map((e, i) => ({
        position: i + 1, puuid: e.puuid, riotId: i < named ? names[i] ?? null : null, lp: e.leaguePoints, wins: e.wins, losses: e.losses,
        winrate: e.wins + e.losses ? Math.round((e.wins / (e.wins + e.losses)) * 100) : null, hotStreak: !!e.hotStreak, freshBlood: !!e.freshBlood, veteran: !!e.veteran,
      })),
    };
  }
  try {
    const value = await build();
    if (!opts.client) boardCache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    riotError(e);
  }
}

/** Recherche par PUUID (lien depuis le classement) : retrouve le Riot ID puis le profil. */
export async function lookupByPuuid(puuid: string, platform: string, opts: { page?: number; client?: RiotClient } = {}) {
  const plat = checkPlatform(platform);
  const c = client(opts.client);
  const name = await riotIdOf(c, puuid, plat);
  if (!name) throw new HttpError(404, "not_found", "Joueur introuvable.");
  return lookupPlayer(name, plat, opts);
}
