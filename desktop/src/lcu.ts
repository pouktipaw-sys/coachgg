// Client League of Legends (LCU) : API locale officielle du client (lockfile), utilisée PENDANT LA SÉLECTION
// DES CHAMPIONS uniquement, comme les applications d'aide connues :
//   • lire la sélection (ton rôle, ton champion, les champions déjà pris) ;
//   • créer une page de runes « CoachGG » et un ensemble d'objets dans le client ;
// Jamais en partie : aucune lecture de la mémoire du jeu, aucun affichage par-dessus le jeu, aucune automatisation
// d'action (le joueur choisit et verrouille lui-même ; l'import des runes est désactivable).
import { existsSync, readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";

export type Lockfile = { port: number; password: string; protocol: string };

/** « LeagueClient:1234:54321:motdepasse:https » → port et mot de passe. */
export function parseLockfile(text: string): Lockfile | null {
  const [, , port, password, protocol] = text.trim().split(":");
  if (!port || !password || !Number(port)) return null;
  return { port: Number(port), password, protocol: protocol ?? "https" };
}

/** Emplacements courants du client ; LEAGUE_DIR ou la configuration peuvent en ajouter un. */
export function findLockfile(extra?: string): Lockfile | null {
  const candidates = [
    extra,
    process.env.LEAGUE_DIR && path.join(process.env.LEAGUE_DIR, "lockfile"),
    "C:\\Riot Games\\League of Legends\\lockfile",
    "D:\\Riot Games\\League of Legends\\lockfile",
    "/Applications/League of Legends.app/Contents/LoL/lockfile",
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    try {
      if (existsSync(p)) return parseLockfile(readFileSync(p, "utf8"));
    } catch {
      /* fichier verrouillé ou illisible : essai suivant */
    }
  }
  return null;
}

export type LcuTransport = (method: string, path: string, body?: unknown) => Promise<{ status: number; data: unknown }>;

/** Transport HTTPS local : certificat auto-signé du client accepté UNIQUEMENT pour 127.0.0.1. */
export function httpsTransport(lock: Lockfile): LcuTransport {
  const auth = Buffer.from(`riot:${lock.password}`).toString("base64");
  return (method, p, body) =>
    new Promise((resolve) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = https.request(
        { host: "127.0.0.1", port: lock.port, path: p, method, rejectUnauthorized: false, timeout: 3000, headers: { Authorization: `Basic ${auth}`, Accept: "application/json", ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}) } },
        (res) => {
          let s = "";
          res.on("data", (d) => (s += d));
          res.on("end", () => {
            let data: unknown = null;
            try {
              data = s ? JSON.parse(s) : null;
            } catch {
              data = s;
            }
            resolve({ status: res.statusCode ?? 0, data });
          });
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve({ status: 0, data: null }));
      if (payload) req.write(payload);
      req.end();
    });
}

export type ChampSelect = {
  localPlayerCellId: number;
  myTeam: { cellId: number; championId: number; championPickIntent?: number; assignedPosition?: string }[];
  theirTeam: { cellId: number; championId: number; assignedPosition?: string }[];
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[] };
  actions?: { actorCellId: number; championId: number; completed: boolean; type: string }[][];
};

export type RunePage = { primaryStyleId: number; subStyleId: number; selectedPerkIds: number[] };

const POSITIONS: Record<string, string> = { top: "TOP", jungle: "JUNGLE", middle: "MIDDLE", bottom: "BOTTOM", utility: "UTILITY" };

export class Lcu {
  constructor(private t: LcuTransport) {}

  async champSelect(): Promise<ChampSelect | null> {
    const r = await this.t("GET", "/lol-champ-select/v1/session");
    return r.status === 200 ? (r.data as ChampSelect) : null;
  }

  async summonerId(): Promise<number | null> {
    const r = await this.t("GET", "/lol-summoner/v1/current-summoner");
    return r.status === 200 ? ((r.data as { summonerId?: number }).summonerId ?? null) : null;
  }

  /**
   * Page de runes « CoachGG » : remplace la précédente page CoachGG, sinon la page actuelle si elle est modifiable
   * (les pages sont limitées), puis la rend active.
   */
  async applyRunes(page: RunePage, name: string) {
    const pages = await this.t("GET", "/lol-perks/v1/pages");
    const list = (pages.status === 200 ? (pages.data as { id: number; name: string; isDeletable: boolean; current: boolean }[]) : []) ?? [];
    const old = list.find((p) => p.isDeletable && p.name.startsWith("CoachGG")) ?? list.find((p) => p.isDeletable && p.current);
    if (old) await this.t("DELETE", `/lol-perks/v1/pages/${old.id}`);
    const r = await this.t("POST", "/lol-perks/v1/pages", { name: name.slice(0, 40), primaryStyleId: page.primaryStyleId, subStyleId: page.subStyleId, selectedPerkIds: page.selectedPerkIds, current: true });
    return r.status >= 200 && r.status < 300;
  }

  /** Ensemble d'objets « CoachGG » pour le champion (remplace le précédent du même champion). */
  async applyItemSet(summonerId: number, championId: number, title: string, items: number[]) {
    const cur = await this.t("GET", `/lol-item-sets/v1/item-sets/${summonerId}/sets`);
    const data = (cur.status === 200 ? (cur.data as { itemSets?: unknown[]; timestamp?: number }) : null) ?? { itemSets: [] };
    const sets = (data.itemSets ?? []).filter((s) => {
      const x = s as { title?: string; associatedChampions?: number[] };
      return !(x.title?.startsWith("CoachGG") && x.associatedChampions?.includes(championId));
    });
    sets.push({
      title: title.slice(0, 60), type: "custom", map: "SR", mode: "any", sortrank: 0, startedFrom: "blank",
      associatedChampions: [championId], associatedMaps: [11], preferredItemSlots: [],
      blocks: [{ type: "Ordre d'achat conseillé (CoachGG)", items: items.map((id) => ({ id: String(id), count: 1 })) }],
    });
    const r = await this.t("PUT", `/lol-item-sets/v1/item-sets/${summonerId}/sets`, { ...data, itemSets: sets, timestamp: Date.now() });
    return r.status >= 200 && r.status < 300;
  }
}

/** Ce qu'il faut savoir de la sélection : ton rôle, ton champion (verrouillé ou non), champions pris et bannis. */
export function readChampSelect(s: ChampSelect) {
  const me = s.myTeam.find((p) => p.cellId === s.localPlayerCellId);
  const role = me?.assignedPosition ? POSITIONS[me.assignedPosition.toLowerCase()] ?? null : null;
  const picks = (s.actions ?? []).flat().filter((a) => a.type === "pick");
  const myPick = picks.find((a) => a.actorCellId === s.localPlayerCellId && a.championId > 0);
  const championId = me?.championId || myPick?.championId || 0;
  const locked = !!myPick?.completed && championId > 0;
  const taken = [...s.myTeam.map((p) => p.championId), ...s.theirTeam.map((p) => p.championId), ...(s.bans?.myTeamBans ?? []), ...(s.bans?.theirTeamBans ?? [])].filter((id) => id > 0 && id !== championId);
  const enemyLaner = role ? s.theirTeam.find((p) => p.assignedPosition && POSITIONS[p.assignedPosition.toLowerCase()] === role && p.championId > 0)?.championId ?? null : null;
  return { role, championId, locked, taken: [...new Set(taken)], enemyLaner };
}
