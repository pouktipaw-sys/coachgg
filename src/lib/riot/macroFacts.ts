// Erreurs SANS mort mesurées par la timeline Riot (fonctions pures, testées) :
// • retour à la base raté : beaucoup d'or gardé plusieurs minutes sans rentrer acheter ;
// • retour au mauvais moment : achat à la base juste avant un objectif pris par l'ennemi ;
// • sbires perdus : plusieurs minutes de suite bien en dessous de son rythme habituel, en vie ;
// • bilan de voie : écart de sbires et d'or avec l'adversaire direct à 10 et 15 min.
// Résolution : une mesure par minute (or, sbires, position) ; achats et objectifs à la seconde.
import { type CompactTimeline, type Pos, isDeadAt, positionAt } from "./timelineFacts";

export type MacroMistake = {
  kind: "MISSED_BACK" | "BAD_BACK" | "CS_DROP";
  flag: "missed_back" | "bad_back" | "cs_drop";
  t: number; // temps de jeu (ms) du moment de décision
  endT: number; // fin de la fenêtre concernée
  title: string;
  observations: string[];
  advice: string;
  myPos: Pos | null;
  where?: Pos; // lieu de l'objectif perdu (retour au mauvais moment)
  facts: { gold?: number; minutes?: number; csLost?: number; csDone?: number; csUsual?: number; objective?: string; afterSec?: number };
};

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const fr = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");
const PIT: Record<string, Pos> = { DRAGON: { x: 9866, y: 4414 }, BARON: { x: 5007, y: 10471 }, HERALD: { x: 5007, y: 10471 }, GRUBS: { x: 5007, y: 10471 }, ATAKHAN: { x: 7400, y: 7400 } };
const OBJ_LABEL: Record<string, string> = { DRAGON: "le dragon", BARON: "le Nashor", HERALD: "le Héraut", GRUBS: "les larves", ATAKHAN: "Atakhan" };

export const MISSED_BACK_GOLD = 1500;
const MISSED_BACK_MIN_MS = 120_000;
const BAD_BACK_WINDOW_MS = 75_000;

/** Passages à la boutique : achats regroupés (à moins de 30 s d'intervalle) ; heure du premier achat. */
export function shopVisits(ct: CompactTimeline, pid: number): number[] {
  if (ct.buys?.length) {
    const ts = ct.buys.filter((b) => b.pid === pid && b.t > 90_000).map((b) => b.t).sort((a, b) => a - b);
    const visits: number[] = [];
    for (const t of ts) if (!visits.length || t - (visits.at(-1) ?? 0) > 30_000) visits.push(t);
    return visits;
  }
  // Ancienne timeline sans achats : l'or en poche chute nettement d'une minute à l'autre.
  const key = String(pid);
  const visits: number[] = [];
  for (let i = 1; i < ct.frames.length; i++) {
    const a = ct.frames[i - 1]!.cur?.[key];
    const b = ct.frames[i]!.cur?.[key];
    if (a != null && b != null && a - b >= 400) visits.push(ct.frames[i]!.t - 30_000);
  }
  return visits;
}

function missedBacks(ct: CompactTimeline, pid: number, visits: number[]): MacroMistake[] {
  const key = String(pid);
  const end = ct.frames.at(-1)?.t ?? 0;
  const out: MacroMistake[] = [];
  let run: { start: number; last: number; peak: number; first: number } | null = null;
  const close = () => {
    if (run && run.last - run.start >= MISSED_BACK_MIN_MS && run.start < end - 120_000) {
      const minutes = Math.round((run.last - run.start) / 60_000);
      const diedHolding = ct.kills.find((k) => k.victim === pid && k.t >= run!.start && k.t <= run!.last + 60_000);
      out.push({
        kind: "MISSED_BACK", flag: "missed_back", t: run.start, endT: run.last,
        title: `Retour raté : ${fr(run.peak)} or gardé ${minutes} min sans rentrer (${mmss(run.start)}–${mmss(run.last)})`,
        observations: [
          `${mmss(run.start)} : tu as déjà ${fr(run.first)} or en poche, assez pour un objet.`,
          `Tu restes ${minutes} minute(s) sans passer à la boutique : tes adversaires jouent avec leurs objets, toi non.`,
          ...(diedHolding ? [`Tu meurs à ${mmss(diedHolding.t)} avec cet or non dépensé.`] : []),
        ],
        advice: "Dès que tu as l'or d'un objet important, pousse ta vague puis rentre : un retour au bon moment vaut plus que quelques sbires.",
        myPos: positionAt(ct, pid, run.start),
        facts: { gold: run.peak, minutes },
      });
    }
    run = null;
  };
  for (const f of ct.frames) {
    const g = f.cur?.[key];
    if (g == null || f.t < 180_000) continue;
    const shopped = run && visits.some((v) => v > run!.start && v <= f.t);
    if (g >= MISSED_BACK_GOLD && !isDeadAt(ct, pid, f.t) && !shopped) {
      if (!run) run = { start: f.t, last: f.t, peak: g, first: g };
      else {
        run.last = f.t;
        run.peak = Math.max(run.peak, g);
      }
    } else close();
  }
  close();
  return out.slice(0, 3);
}

function badBacks(ct: CompactTimeline, pid: number, teamId: number, visits: number[]): MacroMistake[] {
  const out: MacroMistake[] = [];
  for (const o of ct.objectives) {
    if (o.team === teamId || !PIT[o.kind]) continue;
    const v = visits.filter((s) => s <= o.t && o.t - s <= BAD_BACK_WINDOW_MS && !isDeadAt(ct, pid, s - 10_000)).at(-1);
    if (v == null) continue;
    const label = OBJ_LABEL[o.kind]!;
    const after = Math.round((o.t - v) / 1000);
    const recallStart = Math.max(0, v - 10_000); // ~8 s de canalisation avant l'achat
    out.push({
      kind: "BAD_BACK", flag: "bad_back", t: recallStart, endT: o.t,
      title: `Retour à la base ${after} s avant que l'ennemi prenne ${label} (${mmss(o.t)})`,
      observations: [
        `${mmss(v)} : tu achètes à la base.`,
        `${mmss(o.t)} : l'équipe adverse prend ${label}, ${after} s plus tard, pendant que tu reviens.`,
        `Un retour se prépare : rentrer juste avant un objectif laisse ton équipe à 4 contre 5.`,
      ],
      advice: `Rentre AVANT la minute qui précède ${label} (tu reviens à temps avec tes objets), ou reste et rentre juste après.`,
      myPos: positionAt(ct, pid, recallStart),
      where: PIT[o.kind],
      facts: { objective: label, afterSec: after },
    });
  }
  return out;
}

/** Sbires tués par minute : nombre de sbires gagnés entre deux mesures, pour les minutes connues. */
function csPerMinute(ct: CompactTimeline, pid: number) {
  const key = String(pid);
  const out: { t: number; d: number; dead: boolean }[] = [];
  for (let i = 1; i < ct.frames.length; i++) {
    const a = ct.frames[i - 1]!;
    const b = ct.frames[i]!;
    const ca = a.cs?.[key];
    const cb = b.cs?.[key];
    if (ca == null || cb == null) continue;
    // Mort pendant une bonne partie de la minute : la minute ne compte pas (sbires perdus à cause de la mort).
    const dead = [0.25, 0.5, 0.75].filter((k) => isDeadAt(ct, pid, a.t + k * (b.t - a.t))).length >= 2;
    out.push({ t: a.t, d: cb - ca, dead });
  }
  return out;
}

function csDrops(ct: CompactTimeline, pid: number, role: string | null | undefined, visits: number[]): MacroMistake[] {
  if (role === "UTILITY") return []; // le support ne tue pas les sbires
  const mins = csPerMinute(ct, pid).filter((m) => m.t >= 3 * 60_000 && m.t < 25 * 60_000);
  const alive = mins.filter((m) => !m.dead).map((m) => m.d).sort((a, b) => a - b);
  if (alive.length < 5) return [];
  const usual = alive[Math.floor(alive.length / 2)]!;
  if (usual < 4) return [];
  const low = (m: { d: number; dead: boolean }) => !m.dead && m.d <= usual * 0.4;
  const out: MacroMistake[] = [];
  for (let i = 0; i < mins.length; i++) {
    if (!low(mins[i]!)) continue;
    let j = i;
    while (j + 1 < mins.length && low(mins[j + 1]!)) j++;
    const n = j - i + 1;
    const start = mins[i]!.t;
    const stop = mins[j]!.t + 60_000;
    // Une minute basse isolée = un retour à la base normal ; il en faut au moins 2 de suite.
    if (n >= 2) {
      const done = mins.slice(i, j + 1).reduce((s, m) => s + m.d, 0);
      const lost = Math.round(usual * n - done);
      const shopped = visits.some((v) => v >= start && v <= stop);
      out.push({
        kind: "CS_DROP", flag: "cs_drop", t: start, endT: stop,
        title: `Sbires perdus de ${mmss(start)} à ${mmss(stop)} (environ −${lost})`,
        observations: [
          `De ${mmss(start)} à ${mmss(stop)}, tu tues ${done} sbire(s) en ${n} minutes, contre ${usual} par minute d'habitude dans cette partie.`,
          `Tu étais en vie pendant ce temps${shopped ? " (un passage à la boutique compris)" : ""} : environ ${lost} sbires, soit ~${fr(lost * 20)} or, laissés sur la carte.`,
        ],
        advice: role === "JUNGLE"
          ? "Entre deux actions, enchaîne tes camps : une jungle qui ne tourne pas, c'est de l'or et de l'expérience perdus."
          : "Avant de quitter ta voie, pousse la vague ; si tu te déplaces, que ce soit pour un objectif ou un kill précis, puis reviens vite.",
        myPos: positionAt(ct, pid, start + 30_000),
        facts: { csLost: lost, csDone: done, csUsual: usual, minutes: n },
      });
    }
    i = j;
  }
  return out.filter((m) => (m.facts.csLost ?? 0) >= 8).slice(0, 3);
}

/** Toutes les erreurs sans mort du joueur, triées dans l'ordre de la partie. */
export function macroMistakes(ct: CompactTimeline, puuid: string): MacroMistake[] {
  const me = ct.participants.find((p) => p.puuid === puuid);
  if (!me) return [];
  const visits = shopVisits(ct, me.pid);
  return [...missedBacks(ct, me.pid, visits), ...badBacks(ct, me.pid, me.teamId, visits), ...csDrops(ct, me.pid, me.role, visits)].sort((a, b) => a.t - b.t);
}

export type LaneSummary = { opponent: string; role: string; at: { minute: number; csDiff: number | null; goldDiff: number | null }[] };

/** Écart de sbires et d'or avec l'adversaire direct (même rôle, autre équipe) à 10 et 15 min. */
export function laneSummary(ct: CompactTimeline, puuid: string): LaneSummary | null {
  const me = ct.participants.find((p) => p.puuid === puuid);
  if (!me?.role) return null;
  const opp = ct.participants.find((p) => p.teamId !== me.teamId && p.role === me.role);
  if (!opp) return null;
  const at = [10, 15]
    .map((minute) => {
      const f = ct.frames.find((x) => Math.abs(x.t - minute * 60_000) <= 30_000);
      if (!f) return null;
      const d = (r?: Record<string, number>) => (r?.[String(me.pid)] != null && r?.[String(opp.pid)] != null ? r[String(me.pid)]! - r[String(opp.pid)]! : null);
      return { minute, csDiff: d(f.cs), goldDiff: d(f.gold) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && (x.csDiff != null || x.goldDiff != null));
  return at.length ? { opponent: opp.champion, role: me.role, at } : null;
}

/** Phrase de bilan de voie, ex. « À 15 min face à Zed : −22 sbires, −850 or. » */
export function laneSentence(s: LaneSummary | null): string | null {
  if (!s) return null;
  const last = s.at.at(-1)!;
  const sign = (n: number) => (n > 0 ? `+${fr(n)}` : n < 0 ? `−${fr(-n)}` : "0");
  const parts = [last.csDiff != null ? `${sign(last.csDiff)} sbires` : null, last.goldDiff != null ? `${sign(last.goldDiff)} or` : null].filter(Boolean);
  return `À ${last.minute} min face à ${s.opponent} : ${parts.join(", ")}.`;
}
