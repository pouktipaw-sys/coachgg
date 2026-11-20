// Pastilles de faits affichées sous le titre d'un moment dans la vidéo (fonction pure, testée).
// Courtes, mesurées, colorées selon leur sens : rouge = défavorable, orange = attention, vert = favorable.
export type Chip = { text: string; tone: "bad" | "warn" | "good" | "info" };

type Facts = {
  enemiesInvolved?: number;
  alliesNear?: unknown[];
  levels?: { me: number; enemies: number | null };
  unspentGold?: number | null;
  wardsLast3min?: number;
  enemyHalf?: boolean;
  objectivesUp?: { kind: string; inSec: number }[];
  objectiveLost?: { label: string; after: number } | null;
  tradedBack?: boolean;
  deathTimerSec?: number;
};

const fr = (n: number) => n.toLocaleString("fr-FR").replace(/ /g, " ");

export function momentChips(evidence: unknown): Chip[] {
  const e = (evidence ?? {}) as { type?: string; facts?: Facts; absence?: { kind: string; distance: number } };
  const chips: Chip[] = [];
  if (e.type === "riot_absence" && e.absence) {
    chips.push({ text: `À ${fr(Math.round(e.absence.distance / 100) * 100)} unités`, tone: "bad" });
    chips.push({ text: e.absence.kind === "FIGHT" ? "Combat perdu sans toi" : "Objectif perdu", tone: "bad" });
    return chips;
  }
  const f = e.facts;
  if (!f) return chips;
  const allies = (f.alliesNear?.length ?? 0) + 1;
  if (f.enemiesInvolved) chips.push({ text: `${allies} contre ${f.enemiesInvolved}`, tone: f.enemiesInvolved > allies ? "bad" : "info" });
  if (f.levels?.enemies != null) {
    const gap = Math.round((f.levels.enemies - f.levels.me) * 10) / 10;
    chips.push({ text: `Niv. ${f.levels.me} vs ${String(f.levels.enemies).replace(".", ",")}`, tone: gap >= 2 ? "bad" : gap >= 1 ? "warn" : gap <= -1 ? "good" : "info" });
  }
  if (f.unspentGold != null && f.unspentGold >= 1200) chips.push({ text: `${fr(f.unspentGold)} or en poche`, tone: f.unspentGold >= 1500 ? "bad" : "warn" });
  if (f.enemyHalf && !f.wardsLast3min) chips.push({ text: "Sans balise", tone: "bad" });
  if (f.objectiveLost) chips.push({ text: `${cap(f.objectiveLost.label)} perdu (+${f.objectiveLost.after} s)`, tone: "bad" });
  else for (const o of f.objectivesUp ?? []) chips.push({ text: o.inSec <= 0 ? `${o.kind === "DRAGON" ? "Dragon" : "Nashor"} dispo` : `${o.kind === "DRAGON" ? "Dragon" : "Nashor"} dans ${o.inSec} s`, tone: "warn" });
  if (f.tradedBack) chips.push({ text: "Échange", tone: "good" });
  if (f.deathTimerSec != null && f.deathTimerSec >= 25) chips.push({ text: `${f.deathTimerSec} s mort`, tone: "warn" });
  return chips.slice(0, 6);
}

const cap = (s: string) => (s.startsWith("le ") ? s.slice(3) : s.startsWith("les ") ? s.slice(4) : s).replace(/^./, (c) => c.toUpperCase());
