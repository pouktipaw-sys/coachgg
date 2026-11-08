// Détection de partie via l'API locale du client League of Legends
// (https://127.0.0.1:2999/liveclientdata/…), en LECTURE SEULE.
//
// Usage strictement limité : savoir si une partie est en cours (pour enregistrer),
// connaître l'horloge de jeu (synchronisation vidéo) et mémoriser les événements
// pour les exploiter APRÈS le match. Aucun affichage, aucun conseil en partie,
// aucune lecture mémoire, aucune interaction avec le processus du jeu.
import https from "node:https";

export type LiveEvent = { name: string; gameTimeMs: number; killer?: string | null; victim?: string | null; assisters?: string[] };

export interface GameProbe {
  gameTime(): Promise<number | null>; // secondes, null si aucune partie
  events(): Promise<LiveEvent[]>;
  activePlayer(): Promise<string | null>;
}

/** Requête locale : le client utilise un certificat auto-signé, accepté UNIQUEMENT pour 127.0.0.1. */
function getJson<T>(base: string, path: string, timeoutMs = 1500): Promise<T | null> {
  const url = new URL(path, base);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("L'API du client doit être locale.");
  return new Promise((resolve) => {
    const req = https.get(url, { rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

type RawEvent = { EventName: string; EventTime: number; KillerName?: string; VictimName?: string; Assisters?: string[] };

export function parseEvents(raw: { Events?: RawEvent[] } | null): LiveEvent[] {
  return (raw?.Events ?? [])
    .filter((e) => typeof e.EventName === "string" && typeof e.EventTime === "number")
    .map((e) => ({
      name: e.EventName,
      gameTimeMs: Math.max(0, Math.round(e.EventTime * 1000)),
      killer: e.KillerName ?? null,
      victim: e.VictimName ?? null,
      assisters: e.Assisters ?? [],
    }));
}

export class LiveClientProbe implements GameProbe {
  constructor(private base = "https://127.0.0.1:2999") {}
  async gameTime() {
    const s = await getJson<{ gameTime?: number }>(this.base, "/liveclientdata/gamestats");
    return typeof s?.gameTime === "number" ? s.gameTime : null;
  }
  async events() {
    return parseEvents(await getJson<{ Events: RawEvent[] }>(this.base, "/liveclientdata/eventdata"));
  }
  async activePlayer() {
    const n = await getJson<string>(this.base, "/liveclientdata/activeplayername");
    return typeof n === "string" ? n : null;
  }
}

export type WatcherEvent = { type: "start"; gameTimeSec: number } | { type: "end"; reason: "game_end_event" | "client_gone" };

/**
 * Machine à états : NO_GAME → IN_GAME → (fin) → NO_GAME.
 * Fin : événement GameEnd, ou API injoignable pendant `missesToEnd` sondages consécutifs.
 */
export class GameWatcher {
  state: "NO_GAME" | "IN_GAME" = "NO_GAME";
  private misses = 0;
  lastEvents: LiveEvent[] = [];
  activePlayer: string | null = null;

  constructor(private probe: GameProbe, private missesToEnd = 3) {}

  async tick(): Promise<WatcherEvent | null> {
    const t = await this.probe.gameTime();
    if (this.state === "NO_GAME") {
      if (t == null) return null;
      this.state = "IN_GAME";
      this.misses = 0;
      this.lastEvents = [];
      this.activePlayer = await this.probe.activePlayer();
      return { type: "start", gameTimeSec: t };
    }
    if (t == null) {
      this.misses++;
      if (this.misses >= this.missesToEnd) {
        this.state = "NO_GAME";
        return { type: "end", reason: "client_gone" };
      }
      return null;
    }
    this.misses = 0;
    const ev = await this.probe.events();
    if (ev.length >= this.lastEvents.length) this.lastEvents = ev; // l'API renvoie la liste cumulée
    this.activePlayer ??= await this.probe.activePlayer();
    if (ev.some((e) => e.name === "GameEnd")) {
      this.state = "NO_GAME";
      return { type: "end", reason: "game_end_event" };
    }
    return null;
  }
}
