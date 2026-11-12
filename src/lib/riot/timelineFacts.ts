// Faits mesurés à partir de la timeline MATCH-V5 (fonctions pures, testées).
// La timeline donne : positions de chaque joueur une fois par minute, chaque kill avec sa
// position exacte, le tueur et les assistants, les objectifs, les balises posées.
// Les positions entre deux minutes sont INTERPOLÉES : elles sont signalées comme estimées.

export const MAP_SIZE = { x: 14870, y: 14980 }; // Faille de l'invocateur, unités de jeu
export type Pos = { x: number; y: number };

export type CompactTimeline = {
  v: 1;
  participants: { pid: number; puuid: string; teamId: number; champion: string }[];
  frames: { t: number; pos: Record<string, Pos>; gold: Record<string, number> }[];
  kills: { t: number; pos: Pos; killer: number; victim: number; assists: number[] }[];
  objectives: { t: number; kind: "DRAGON" | "BARON" | "HERALD" | "GRUBS" | "ATAKHAN" | "TOWER" | "INHIBITOR" | "OTHER"; team: number }[];
  wards: { t: number; pid: number }[];
};

type RawEvent = {
  type: string;
  timestamp: number;
  position?: Pos;
  killerId?: number;
  victimId?: number;
  assistingParticipantIds?: number[];
  monsterType?: string;
  buildingType?: string;
  teamId?: number;
  killerTeamId?: number;
  creatorId?: number;
};
type RawTimeline = {
  metadata: { participants: string[] };
  info: { frames: { timestamp: number; events: RawEvent[]; participantFrames?: Record<string, { position?: Pos; totalGold?: number }> }[] };
};

const MONSTERS: Record<string, CompactTimeline["objectives"][number]["kind"]> = {
  DRAGON: "DRAGON", BARON_NASHOR: "BARON", RIFTHERALD: "HERALD", HORDE: "GRUBS", ATAKHAN: "ATAKHAN",
};

/** Réduit la timeline brute aux informations utiles à l'analyse (quelques dizaines de Ko). */
export function compactTimeline(t: RawTimeline, players: { puuid: string; teamId: number; champion: string }[]): CompactTimeline {
  const participants = t.metadata.participants.map((puuid, i) => {
    const p = players.find((x) => x.puuid === puuid);
    return { pid: i + 1, puuid, teamId: p?.teamId ?? (i < 5 ? 100 : 200), champion: p?.champion ?? `Joueur ${i + 1}` };
  });
  const teamOf = (pid: number) => participants.find((p) => p.pid === pid)?.teamId ?? 0;
  const out: CompactTimeline = { v: 1, participants, frames: [], kills: [], objectives: [], wards: [] };
  for (const f of t.info.frames) {
    const pos: Record<string, Pos> = {};
    const gold: Record<string, number> = {};
    for (const [pid, pf] of Object.entries(f.participantFrames ?? {})) {
      if (pf.position) pos[pid] = { x: pf.position.x, y: pf.position.y };
      if (pf.totalGold != null) gold[pid] = pf.totalGold;
    }
    out.frames.push({ t: f.timestamp, pos, gold });
    for (const e of f.events) {
      if (e.type === "CHAMPION_KILL" && e.position && e.victimId)
        out.kills.push({ t: e.timestamp, pos: e.position, killer: e.killerId ?? 0, victim: e.victimId, assists: e.assistingParticipantIds ?? [] });
      else if (e.type === "ELITE_MONSTER_KILL")
        out.objectives.push({ t: e.timestamp, kind: MONSTERS[e.monsterType ?? ""] ?? "OTHER", team: e.killerTeamId ?? teamOf(e.killerId ?? 0) });
      else if (e.type === "BUILDING_KILL")
        // teamId = équipe PROPRIÉTAIRE du bâtiment détruit → l'objectif profite à l'autre équipe.
        out.objectives.push({ t: e.timestamp, kind: e.buildingType === "INHIBITOR_BUILDING" ? "INHIBITOR" : "TOWER", team: e.teamId === 100 ? 200 : 100 });
      else if (e.type === "WARD_PLACED" && e.creatorId) out.wards.push({ t: e.timestamp, pid: e.creatorId });
    }
  }
  return out;
}

/** Position estimée d'un joueur à l'instant t (interpolation linéaire entre deux minutes). */
export function positionAt(ct: CompactTimeline, pid: number, t: number): Pos | null {
  const key = String(pid);
  const frames = ct.frames.filter((f) => f.pos[key]);
  if (!frames.length) return null;
  let before = frames[0]!;
  for (const f of frames) if (f.t <= t) before = f;
  const after = frames.find((f) => f.t > t);
  if (!after || after === before) return before.pos[key]!;
  const k = (t - before.t) / (after.t - before.t);
  const a = before.pos[key]!;
  const b = after.pos[key]!;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

export const dist = (a: Pos, b: Pos) => Math.round(Math.hypot(a.x - b.x, a.y - b.y));
/** Coordonnées de jeu → position normalisée sur la minimap (origine en haut à gauche). */
export const toMinimap = (p: Pos) => ({ x: Math.min(1, Math.max(0, p.x / MAP_SIZE.x)), y: Math.min(1, Math.max(0, 1 - p.y / MAP_SIZE.y)) });
const FOUNTAIN: Record<number, Pos> = { 100: { x: 400, y: 400 }, 200: { x: 14400, y: 14400 } };
/** Moitié de carte : au-delà de la diagonale de la rivière (côté adverse). */
export const inEnemyHalf = (p: Pos, team: number) => (team === 100 ? p.x + p.y > 15000 : p.x + p.y < 14700);

const NEAR = 2500; // unités : distance à laquelle un allié peut intervenir dans un combat
const OBJ_FR: Record<string, string> = { DRAGON: "le dragon", BARON: "le Nashor", HERALD: "le Héraut", GRUBS: "les larves", ATAKHAN: "Atakhan", TOWER: "une tour", INHIBITOR: "un inhibiteur", OTHER: "un objectif" };

export type DeathFacts = {
  t: number;
  pos: Pos;
  killer: string | null;
  enemiesInvolved: number;
  enemies: { champion: string; pos: Pos | null }[];
  alliesNear: { champion: string; distance: number; pos: Pos }[];
  nearestAlly: { champion: string; distance: number } | null;
  wardsLast3min: number;
  enemyHalf: boolean;
  tradedBack: boolean;
  objectiveLost: { kind: string; label: string; after: number } | null;
  goldDiff: number | null;
  safePoint: Pos;
};

export function myDeaths(ct: CompactTimeline, puuid: string) {
  const me = ct.participants.find((p) => p.puuid === puuid);
  return me ? ct.kills.filter((k) => k.victim === me.pid) : [];
}

export function deathFacts(ct: CompactTimeline, puuid: string, death: CompactTimeline["kills"][number]): DeathFacts {
  const me = ct.participants.find((p) => p.puuid === puuid)!;
  const champ = (pid: number) => ct.participants.find((p) => p.pid === pid)?.champion ?? "?";
  const enemyIds = [death.killer, ...death.assists].filter((pid) => pid > 0 && ct.participants.find((p) => p.pid === pid)?.teamId !== me.teamId);
  const allies = ct.participants.filter((p) => p.teamId === me.teamId && p.pid !== me.pid);
  // Un allié mort au même moment (±10 s) n'était pas là pour aider : on ne le compte pas comme proche.
  const deadAround = new Set(ct.kills.filter((k) => Math.abs(k.t - death.t) <= 10_000 && k.victim !== me.pid).map((k) => k.victim));
  const allyDist = allies
    .map((a) => ({ a, p: positionAt(ct, a.pid, death.t) }))
    .filter((x): x is { a: (typeof allies)[number]; p: Pos } => !!x.p)
    .map((x) => ({ champion: x.a.champion, distance: dist(x.p, death.pos), pos: x.p, pid: x.a.pid }));
  const nearest = [...allyDist].sort((a, b) => a.distance - b.distance)[0] ?? null;
  const objective = ct.objectives.find((o) => o.team !== me.teamId && o.t > death.t && o.t - death.t <= 60_000) ?? null;
  const frame = [...ct.frames].reverse().find((f) => f.t <= death.t);
  const goldOf = (team: number) => ct.participants.filter((p) => p.teamId === team).reduce((s, p) => s + (frame?.gold[String(p.pid)] ?? 0), 0);
  const fountain = FOUNTAIN[me.teamId] ?? FOUNTAIN[100]!;
  const len = dist(death.pos, fountain) || 1;
  const step = Math.min(2500, len);
  return {
    t: death.t,
    pos: death.pos,
    killer: death.killer > 0 ? champ(death.killer) : null,
    enemiesInvolved: Math.max(1, enemyIds.length),
    enemies: enemyIds.map((pid) => ({ champion: champ(pid), pos: positionAt(ct, pid, death.t) })),
    alliesNear: allyDist.filter((a) => a.distance <= NEAR && !deadAround.has(a.pid)).map(({ champion, distance, pos }) => ({ champion, distance, pos })),
    nearestAlly: nearest ? { champion: nearest.champion, distance: nearest.distance } : null,
    wardsLast3min: ct.wards.filter((w) => w.pid === me.pid && w.t <= death.t && death.t - w.t <= 180_000).length,
    enemyHalf: inEnemyHalf(death.pos, me.teamId),
    tradedBack: death.killer > 0 && ct.kills.some((k) => k.victim === death.killer && k.t >= death.t && k.t - death.t <= 15_000),
    objectiveLost: objective ? { kind: objective.kind, label: OBJ_FR[objective.kind] ?? "un objectif", after: Math.round((objective.t - death.t) / 1000) } : null,
    goldDiff: frame ? goldOf(me.teamId) - goldOf(me.teamId === 100 ? 200 : 100) : null,
    safePoint: { x: death.pos.x + ((fountain.x - death.pos.x) / len) * step, y: death.pos.y + ((fountain.y - death.pos.y) / len) * step },
  };
}

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export type DeathDiagnosis = {
  kind: "MISTAKE" | "INTERESTING";
  category: "POSITIONING" | "VISION" | "ROTATIONS" | "ENGAGEMENT";
  title: string;
  observations: string[];
  interpretation: string;
  alternative: { label: string; conditions: string; limits: string } | null;
  advice: string;
};

/** Diagnostic expliqué d'une mort, fondé uniquement sur les faits mesurés de la timeline. */
export function diagnoseDeath(f: DeathFacts): DeathDiagnosis {
  const at = mmss(f.t);
  const obs: string[] = [];
  obs.push(
    `${at} (jeu) : tué${f.killer ? ` par ${f.killer}` : ""}${f.enemiesInvolved > 1 ? `, ${f.enemiesInvolved} ennemis impliqués (${f.enemies.map((e) => e.champion).join(", ")})` : ""}.`,
  );
  obs.push(
    f.alliesNear.length
      ? `Alliés à portée (moins de 2 500 unités, positions estimées) : ${f.alliesNear.map((a) => `${a.champion} à ${a.distance}`).join(", ")}.`
      : `Aucun allié à portée${f.nearestAlly ? ` : le plus proche, ${f.nearestAlly.champion}, était à environ ${f.nearestAlly.distance} unités (position estimée)` : ""}.`,
  );
  obs.push(f.wardsLast3min ? `${f.wardsLast3min} balise(s) posée(s) par toi dans les 3 minutes avant.` : "Aucune balise posée par toi dans les 3 minutes avant.");
  if (f.enemyHalf) obs.push("Mort dans la moitié adverse de la carte.");
  if (f.objectiveLost) obs.push(`L'équipe adverse prend ${f.objectiveLost.label} ${f.objectiveLost.after} s après ta mort.`);
  if (f.tradedBack) obs.push(`${f.killer} meurt à son tour dans les 15 secondes : échange.`);
  if (f.goldDiff != null) obs.push(`Écart d'or de ton équipe à ce moment : ${f.goldDiff >= 0 ? "+" : ""}${f.goldDiff}.`);

  const isolated = f.alliesNear.length === 0 && f.enemiesInvolved >= 2;
  const outnumbered = f.alliesNear.length > 0 && f.enemiesInvolved > f.alliesNear.length + 1;
  const blind = f.enemyHalf && f.wardsLast3min === 0;

  if (f.tradedBack && !f.objectiveLost)
    return {
      kind: "INTERESTING", category: "ENGAGEMENT", title: `Échange à ${at} : mort, mais ${f.killer} tombe aussi`,
      observations: obs, interpretation: "Mort suivie de celle de ton adversaire : un échange, pas forcément une erreur. Vérifie s'il était favorable (or, objectif, temps de réapparition).",
      alternative: null, advice: "Avant un échange, vérifie que tu y gagnes : un objectif à prendre ou un adversaire plus important que toi.",
    };
  if (f.objectiveLost)
    return {
      kind: "MISTAKE", category: "ROTATIONS", title: `Mort ${f.objectiveLost.after} s avant que l'ennemi prenne ${f.objectiveLost.label}`,
      observations: obs, interpretation: `Ta mort a laissé ton équipe en infériorité numérique juste avant ${f.objectiveLost.label} : c'est souvent là que la partie bascule.`,
      alternative: { label: `Rester en vie et en groupe avant ${f.objectiveLost.label}`, conditions: "dans la minute qui précède l'apparition ou la prise d'un objectif", limits: "l'objectif aurait pu être perdu quand même si l'ennemi avait l'avantage" },
      advice: "Une minute avant un objectif, joue la sécurité : pas d'avancée seul, regroupe-toi et prépare la vision autour.",
    };
  if (isolated)
    return {
      kind: "MISTAKE", category: "POSITIONING", title: `Mort isolé face à ${f.enemiesInvolved} ennemis à ${at}`,
      observations: obs, interpretation: `Aucun allié ne pouvait t'aider${f.nearestAlly ? ` (le plus proche à ~${f.nearestAlly.distance} unités)` : ""} alors que ${f.enemiesInvolved} ennemis sont venus : la position était perdue avant le combat.`,
      alternative: { label: "Reculer vers ton équipe ou ta tour avant le combat", conditions: blind ? "surtout sans vision dans cette zone" : "quand plusieurs ennemis ne sont pas visibles sur la minimap", limits: "positions des alliés estimées à la minute près" },
      advice: blind ? "Ne t'avance pas dans la moitié adverse sans balise ni allié à portée : recule dès que 2 ennemis manquent sur la minimap." : "Quand tu es seul, compte les ennemis visibles sur la minimap : s'il en manque 2, recule vers ton équipe.",
    };
  if (blind)
    return {
      kind: "MISTAKE", category: "VISION", title: `Mort sans vision dans le camp adverse à ${at}`,
      observations: obs, interpretation: "Tu étais dans la moitié adverse sans avoir posé de balise : les ennemis te voyaient avant que tu les voies.",
      alternative: { label: "Poser une balise avant d'entrer dans la zone", conditions: "quand tu traverses la rivière ou entres dans la jungle adverse", limits: "la balise n'empêche pas tout, mais elle te prévient" },
      advice: "Pose ta balise AVANT d'entrer dans une zone sombre, et achète une balise de contrôle à chaque retour.",
    };
  if (outnumbered)
    return {
      kind: "MISTAKE", category: "ENGAGEMENT", title: `Combat en infériorité à ${at} (${f.alliesNear.length + 1} contre ${f.enemiesInvolved})`,
      observations: obs, interpretation: "Ton équipe s'est battue en nombre inférieur : sauf grosse avance, ce combat était difficile à gagner.",
      alternative: { label: "Attendre le regroupement avant d'engager", conditions: "quand un ou plusieurs alliés sont encore en chemin", limits: "positions estimées à la minute près" },
      advice: "Avant d'engager, compte : vous devez être au moins autant que l'ennemi, ou avoir un gros avantage.",
    };
  return {
    kind: "INTERESTING", category: "POSITIONING", title: `Mort à ${at}${f.killer ? ` contre ${f.killer}` : ""}`,
    observations: obs, interpretation: "Aucun schéma d'erreur évident dans les données : revois la vidéo pour juger le placement et le timing.",
    alternative: null, advice: "Revois les 10 secondes avant la mort : où étaient tes alliés, et quelle information te manquait ?",
  };
}
