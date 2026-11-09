// Client minimal de l'API officielle Riot Games (ACCOUNT-V1, MATCH-V5).
// • Clé côté serveur uniquement (RIOT_API_KEY), jamais exposée au navigateur.
// • Données publiques de match : aucune connexion au compte Riot du joueur,
//   aucun mot de passe Riot, aucune lecture mémoire du client de jeu.
// • Une clé « development » expire toutes les 24 h et est limitée en débit ;
//   un produit public nécessite une clé « production » approuvée par Riot.
// Documentation : https://developer.riotgames.com/apis
import { env } from "@/lib/env";

export const PLATFORMS = ["EUW1", "EUN1", "NA1", "KR", "JP1", "BR1", "LA1", "LA2", "OC1", "TR1", "RU", "ME1", "SG2", "TW2", "VN2"] as const;
export type Platform = (typeof PLATFORMS)[number];

export function regionalRoute(platform: string): "europe" | "americas" | "asia" | "sea" {
  switch (platform.toUpperCase()) {
    case "NA1":
    case "BR1":
    case "LA1":
    case "LA2":
      return "americas";
    case "KR":
    case "JP1":
      return "asia";
    case "OC1":
    case "SG2":
    case "TW2":
    case "VN2":
      return "sea";
    default:
      return "europe";
  }
}

/** ACCOUNT-V1 n'est pas servi sur « sea » : on utilise « asia ». */
const accountRoute = (platform: string) => (regionalRoute(platform) === "sea" ? "asia" : regionalRoute(platform));

export class RiotApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export class RiotNotConfiguredError extends Error {
  constructor() {
    super("Intégration Riot non configurée (RIOT_API_KEY absente).");
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class RiotClient {
  constructor(private key: string, private fetcher: FetchLike = fetch, private maxRetries = 2) {}

  private async get<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetcher(url, { headers: { "X-Riot-Token": this.key }, signal: AbortSignal.timeout(10_000) });
      } catch {
        throw new RiotApiError(503, "Service Riot injoignable.");
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = Math.min(10, Number(res.headers.get("retry-after") ?? 1));
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const msg: Record<number, string> = {
        401: "Clé Riot manquante ou invalide.",
        403: "Clé Riot refusée ou expirée (les clés de développement expirent après 24 h).",
        404: "Introuvable côté Riot.",
        429: "Limite de requêtes Riot atteinte, réessayez plus tard.",
      };
      throw new RiotApiError(res.status, msg[res.status] ?? `Erreur API Riot (${res.status}).`);
    }
  }

  accountByRiotId(gameName: string, tagLine: string, platform: string) {
    return this.get<{ puuid: string; gameName: string; tagLine: string }>(
      `https://${accountRoute(platform)}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    );
  }

  matchIds(puuid: string, platform: string, count = 10) {
    return this.get<string[]>(
      `https://${regionalRoute(platform)}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=${Math.min(20, count)}`,
    );
  }

  match(matchId: string) {
    const platform = matchId.split("_")[0] ?? "EUW1";
    return this.get<RiotMatch>(`https://${regionalRoute(platform)}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
  }

  /** LEAGUE-V4 : rang du joueur (servi par l'hôte du serveur de jeu, ex. euw1). */
  leagueEntries(puuid: string, platform: string) {
    return this.get<RiotLeagueEntry[]>(`https://${platform.toLowerCase()}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`);
  }

  /** MATCH-V5 timeline : événements horodatés (ms depuis le début de la partie). */
  timeline(matchId: string) {
    const platform = matchId.split("_")[0] ?? "EUW1";
    return this.get<RiotTimeline>(`https://${regionalRoute(platform)}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`);
  }
}

export type RiotTimeline = {
  metadata: { matchId: string; participants: string[] };
  info: {
    frames: {
      timestamp: number;
      events: { type: string; timestamp: number; victimId?: number; killerId?: number; participantId?: number; itemId?: number }[];
      participantFrames?: Record<string, { totalGold?: number; minionsKilled?: number; jungleMinionsKilled?: number; level?: number }>;
    }[];
  };
};

export type RiotLeagueEntry = { queueType: string; tier: string; rank: string; leaguePoints: number; wins: number; losses: number };

/** Évolution d'un joueur (or, CS cumulés par minute) et achats, à partir de la timeline. */
export function participantTimeline(t: RiotTimeline, puuid: string) {
  const pid = t.metadata.participants.indexOf(puuid) + 1;
  if (pid <= 0) return null;
  const gold: number[] = [];
  const cs: number[] = [];
  for (const f of t.info.frames) {
    const pf = f.participantFrames?.[String(pid)];
    if (!pf) continue;
    gold.push(pf.totalGold ?? 0);
    cs.push((pf.minionsKilled ?? 0) + (pf.jungleMinionsKilled ?? 0));
  }
  const purchases = t.info.frames
    .flatMap((f) => f.events)
    .filter((e) => e.type === "ITEM_PURCHASED" && e.participantId === pid && e.itemId)
    .map((e) => ({ t: e.timestamp, itemId: e.itemId! }));
  return { source: "riot_timeline", gold, cs, purchases };
}

export const RANKED_QUEUES: Record<string, string> = { RANKED_SOLO_5x5: "Classée solo/duo", RANKED_FLEX_SR: "Classée flexible" };

export function riotClient(fetcher?: FetchLike): RiotClient {
  const key = env.riotApiKey;
  if (!key) throw new RiotNotConfiguredError();
  return new RiotClient(key, fetcher);
}

// ───────────── Types (sous-ensemble utilisé) et conversion ─────────────

export type RiotParticipant = {
  puuid: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
  championName: string;
  teamPosition?: string;
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  goldEarned?: number;
  totalDamageDealtToChampions?: number;
  damageDealtToObjectives?: number;
  visionScore?: number;
  wardsPlaced?: number;
  wardsKilled?: number;
  visionWardsBoughtInGame?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
};

export type RiotMatch = {
  metadata: { matchId: string };
  info: {
    gameCreation: number;
    gameStartTimestamp?: number;
    gameDuration: number;
    gameEndTimestamp?: number;
    gameVersion: string;
    queueId: number;
    platformId: string;
    participants: RiotParticipant[];
  };
};

const QUEUES: Record<number, string> = { 420: "RANKED_SOLO", 440: "RANKED_FLEX", 400: "NORMAL", 430: "NORMAL", 490: "NORMAL", 450: "ARAM", 0: "CUSTOM" };
const POSITIONS = new Set(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]);

export function convertRiotMatch(m: RiotMatch) {
  const i = m.info;
  // Avant le patch 11.20, gameDuration était en millisecondes (pas de gameEndTimestamp).
  const durationSec = i.gameEndTimestamp ? i.gameDuration : Math.round(i.gameDuration / 1000);
  const teamStats: Record<string, { kills: number; damageToChampions: number; damageToObjectives: number; complete: boolean }> = {};
  for (const side of [100, 200]) {
    const ps = i.participants.filter((p) => p.teamId === side);
    teamStats[String(side)] = {
      kills: ps.reduce((a, p) => a + p.kills, 0),
      damageToChampions: ps.reduce((a, p) => a + (p.totalDamageDealtToChampions ?? 0), 0),
      damageToObjectives: ps.reduce((a, p) => a + (p.damageDealtToObjectives ?? 0), 0),
      complete: ps.length === 5,
    };
  }
  return {
    riotMatchId: m.metadata.matchId,
    platform: i.platformId,
    queueId: i.queueId,
    gameMode: QUEUES[i.queueId] ?? "OTHER",
    gameStartAt: new Date(i.gameStartTimestamp ?? i.gameCreation),
    durationSec,
    gameVersion: i.gameVersion,
    teamStats,
    participants: i.participants.map((p) => ({
      puuid: p.puuid,
      riotGameName: p.riotIdGameName ?? null,
      riotTagLine: p.riotIdTagline ?? null,
      championName: p.championName,
      role: p.teamPosition && POSITIONS.has(p.teamPosition) ? (p.teamPosition as "TOP") : null,
      teamSide: p.teamId,
      win: p.win,
      stats: {
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        creepScore: p.totalMinionsKilled != null ? p.totalMinionsKilled + (p.neutralMinionsKilled ?? 0) : null,
        goldEarned: p.goldEarned ?? null,
        damageToChampions: p.totalDamageDealtToChampions ?? null,
        damageToObjectives: p.damageDealtToObjectives ?? null,
        visionScore: p.visionScore ?? null,
        wardsPlaced: p.wardsPlaced ?? null,
        wardsKilled: p.wardsKilled ?? null,
        controlWardsBought: p.visionWardsBoughtInGame ?? null,
        items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].filter((x): x is number => !!x),
      },
    })),
  };
}
