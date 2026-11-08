// Moteur de notation : déterministe, pur, versionné et testé.
// Le modèle de langage (s'il est ajouté) EXPLIQUE ces résultats, il ne les produit pas.
import { COMPONENT_LABELS, CURRENT_SCORE_CONFIG, type Anchor, type ComponentKey, type Role, type ScoreConfig } from "./config";

export type ScoringStats = {
  kills: number;
  deaths: number;
  assists: number;
  creepScore?: number | null;
  goldEarned?: number | null;
  damageToChampions?: number | null;
  damageToObjectives?: number | null;
  visionScore?: number | null;
};

export type TeamTotals = {
  kills?: number | null;
  damageToChampions?: number | null;
  damageToObjectives?: number | null;
};

export type ScoringInput = {
  role: Role | null;
  durationSec: number;
  stats: ScoringStats;
  team: TeamTotals;
};

export type ComponentResult = {
  key: ComponentKey;
  label: string;
  available: boolean;
  value: number | null; // valeur brute (ratio, par minute…)
  display: string | null; // valeur lisible
  score: number | null; // 0..10
  weight: number; // pondération du rôle (avant renormalisation)
  anchor: Anchor | null;
  missingReason?: string;
};

export type Factor = { key: ComponentKey; text: string; score: number };

export type ScoreResult = {
  version: string;
  experimental: boolean;
  overall: number | null;
  reliability: "high" | "medium" | "low" | "insufficient";
  reliabilityReasons: string[];
  components: ComponentResult[];
  positives: Factor[];
  negatives: Factor[];
  missingData: string[];
  availableWeight: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Interpolation linéaire bornée : plancher → 0, excellent → 10 (fonctionne aussi pour une échelle inversée). */
export function anchorScore(value: number, a: Anchor): number {
  if (a.excellent === a.floor) return value >= a.excellent ? 10 : 0;
  return round1(clamp((10 * (value - a.floor)) / (a.excellent - a.floor), 0, 10));
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const nonNeg = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

export function computeScore(input: ScoringInput, cfg: ScoreConfig = CURRENT_SCORE_CONFIG): ScoreResult {
  const roleKey = input.role ?? "UNKNOWN";
  const w = cfg.weights[roleKey];
  const minutes = input.durationSec / 60;
  const s = input.stats;
  const t = input.team;
  const components: ComponentResult[] = [];

  const push = (key: ComponentKey, value: number | null, anchor: Anchor, display: (v: number) => string, missingReason?: string) => {
    const available = value !== null;
    components.push({
      key,
      label: COMPONENT_LABELS[key],
      available,
      value: available ? value : null,
      display: available ? display(value) : null,
      score: available ? anchorScore(value, anchor) : null,
      weight: w[key],
      anchor,
      ...(available ? {} : { missingReason }),
    });
  };

  if (!(minutes > 0)) {
    return {
      version: cfg.version,
      experimental: cfg.experimental,
      overall: null,
      reliability: "insufficient",
      reliabilityReasons: ["Durée de partie inconnue ou nulle."],
      components: [],
      positives: [],
      negatives: [],
      missingData: ["Durée de la partie"],
      availableWeight: 0,
    };
  }

  // 1. Ressources
  push(
    "resources",
    nonNeg(s.creepScore) ? s.creepScore / minutes : null,
    cfg.anchors.csPerMin[roleKey],
    (v) => `${v.toFixed(1)} CS/min`,
    "Creep score non renseigné",
  );
  // 2. Participation
  const kp = nonNeg(t.kills) && t.kills > 0 ? Math.min(1, (s.kills + s.assists) / t.kills) : null;
  push(
    "participation",
    kp,
    cfg.anchors.killParticipation,
    pct,
    nonNeg(t.kills) ? "Aucune élimination dans l'équipe" : "Éliminations totales de l'équipe non renseignées",
  );
  // 3. Dégâts
  const ds = nonNeg(s.damageToChampions) && nonNeg(t.damageToChampions) && t.damageToChampions > 0 ? Math.min(1, s.damageToChampions / t.damageToChampions) : null;
  push("damage", ds, cfg.anchors.damageShare[roleKey], pct, "Dégâts du joueur ou de l'équipe non renseignés");
  // 4. Risque (toujours disponible : les morts sont obligatoires)
  push("risk", (s.deaths * 10) / minutes, cfg.anchors.deathsPer10, (v) => `${v.toFixed(1)} morts/10 min`);
  // 5. Vision
  push("vision", nonNeg(s.visionScore) ? s.visionScore / minutes : null, cfg.anchors.visionPerMin[roleKey], (v) => `${v.toFixed(2)} /min`, "Score de vision non renseigné");
  // 6. Objectifs
  const os = nonNeg(s.damageToObjectives) && nonNeg(t.damageToObjectives) && t.damageToObjectives > 0 ? Math.min(1, s.damageToObjectives / t.damageToObjectives) : null;
  push("objectives", os, cfg.anchors.objectiveDamageShare[roleKey], pct, "Dégâts aux objectifs (joueur ou équipe) non renseignés");

  const avail = components.filter((c) => c.available);
  const availableWeight = round1(avail.reduce((a, c) => a + c.weight, 0) * 100) / 100;
  const missingData = components.filter((c) => !c.available).map((c) => `${c.label} : ${c.missingReason}`);

  const reasons: string[] = [];
  let overall: number | null = null;
  let reliability: ScoreResult["reliability"];
  if (availableWeight < cfg.minAvailableWeight) {
    reliability = "insufficient";
    reasons.push(`Seulement ${Math.round(availableWeight * 100)} % des dimensions pondérées sont mesurables (minimum ${Math.round(cfg.minAvailableWeight * 100)} %).`);
  } else {
    overall = round1(avail.reduce((a, c) => a + c.weight * c.score!, 0) / avail.reduce((a, c) => a + c.weight, 0));
    reliability = availableWeight >= 0.95 ? "high" : availableWeight >= 0.75 ? "medium" : "low";
    if (availableWeight < 0.95) reasons.push("Certaines données manquent : la note est calculée sur les dimensions disponibles (pondérations renormalisées).");
    if (input.durationSec < cfg.shortGameSec) {
      reliability = "low";
      reasons.push("Partie courte (< 15 min) : les ratios par minute sont peu représentatifs.");
    }
    if (!input.role) {
      if (reliability === "high") reliability = "medium";
      reasons.push("Rôle inconnu : pondération générique, repères non spécifiques au rôle.");
    }
  }
  if (reasons.length === 0) reasons.push("Toutes les dimensions sont mesurées et la partie est de durée normale.");

  const factor = (c: ComponentResult): Factor => ({
    key: c.key,
    score: c.score!,
    text: `${c.label} : ${c.display} (note ${c.score}/10)`,
  });
  const positives = avail.filter((c) => c.score! >= 7).sort((a, b) => b.score! * b.weight - a.score! * a.weight).slice(0, 3).map(factor);
  // négatifs : impact pondéré le plus fort d'abord
  const negatives = avail
    .filter((c) => c.score! <= 4)
    .sort((a, b) => (10 - b.score!) * b.weight - (10 - a.score!) * a.weight)
    .slice(0, 3)
    .map(factor);

  return {
    version: cfg.version,
    experimental: cfg.experimental,
    overall,
    reliability,
    reliabilityReasons: reasons,
    components,
    positives,
    negatives,
    missingData,
    availableWeight,
  };
}

// ───────────────────────── Progression personnelle ─────────────────────────

export type Progression =
  | { available: true; baseline: number; delta: number; sample: number; trend: "up" | "down" | "stable" }
  | { available: false; reason: string; sample: number };

/** Compare la note à la moyenne des notes précédentes du joueur (même version, idéalement même rôle). */
export function computeProgression(current: number | null, history: number[], minSample = 3): Progression {
  if (current == null) return { available: false, reason: "Note du match indisponible.", sample: history.length };
  if (history.length < minSample)
    return { available: false, reason: `Historique insuffisant (${history.length}/${minSample} parties comparables).`, sample: history.length };
  const baseline = round1(history.reduce((a, b) => a + b, 0) / history.length);
  const delta = round1(current - baseline);
  return { available: true, baseline, delta, sample: history.length, trend: delta >= 0.5 ? "up" : delta <= -0.5 ? "down" : "stable" };
}

// ───────────────────────────── MVP entre amis ─────────────────────────────

export type MvpEntry = {
  userId: string;
  displayName: string;
  overall: number | null;
  components: Pick<ComponentResult, "key" | "score" | "available">[];
  progressionDelta?: number | null;
};

export type Distinction = { key: string; label: string; userId: string; reason: string };

export type MvpResult = {
  mvpUserIds: string[];
  isTie: boolean;
  ranking: { userId: string; displayName: string; overall: number }[];
  excluded: { userId: string; displayName: string; reason: string }[];
  explanation: string;
  distinctions: Distinction[];
};

const DISTINCTIONS: { key: ComponentKey; label: string }[] = [
  { key: "objectives", label: "Contribution aux objectifs" },
  { key: "vision", label: "Vision" },
  { key: "participation", label: "Contribution collective" },
  { key: "risk", label: "Maîtrise du risque" },
];

/**
 * MVP parmi les membres du groupe présents dans la partie (pas parmi les 10 joueurs).
 * Égalité si l'écart avec le meilleur est inférieur au seuil configuré.
 * Aucune distinction négative n'est produite.
 */
export function computeTeamMvp(entries: MvpEntry[], cfg: Pick<ScoreConfig, "tieThreshold" | "distinctionLead"> = CURRENT_SCORE_CONFIG): MvpResult {
  const excluded = entries.filter((e) => e.overall == null).map((e) => ({ userId: e.userId, displayName: e.displayName, reason: "Données insuffisantes pour une note comparable." }));
  const ranked = entries
    .filter((e): e is MvpEntry & { overall: number } => e.overall != null)
    .sort((a, b) => b.overall - a.overall || a.displayName.localeCompare(b.displayName));
  const ranking = ranked.map((e) => ({ userId: e.userId, displayName: e.displayName, overall: e.overall }));

  if (ranked.length === 0)
    return { mvpUserIds: [], isTie: false, ranking, excluded, explanation: "Aucune note comparable : MVP non attribué.", distinctions: [] };
  if (ranked.length === 1 && entries.length === 1)
    return { mvpUserIds: [], isTie: false, ranking, excluded, explanation: "Un seul membre du groupe dans cette partie : pas de MVP de groupe.", distinctions: [] };

  const top = ranked[0]!.overall;
  const mvps = ranked.filter((e) => top - e.overall < cfg.tieThreshold - 1e-9);
  const isTie = mvps.length > 1;
  const second = ranked[mvps.length];
  let explanation: string;
  if (isTie) {
    explanation = `Égalité : ${mvps.map((m) => `${m.displayName} (${m.overall})`).join(", ")} — écart inférieur à ${cfg.tieThreshold} point, non significatif.`;
  } else {
    const m = mvps[0]!;
    const best = m.components.filter((c) => c.available && c.score != null).sort((a, b) => b.score! - a.score!).slice(0, 2);
    const lead = second ? ` avec ${round1(m.overall - second.overall)} point d'avance sur ${second.displayName}` : "";
    explanation = `${m.displayName} obtient la meilleure note du groupe (${m.overall}/10)${lead}. Points forts : ${best.map((b) => COMPONENT_LABELS[b.key]).join(", ") || "—"}.`;
    if (second && m.overall - second.overall < 1) explanation += " Écart faible : à interpréter avec prudence.";
  }

  // Distinctions secondaires : uniquement si la dimension est mesurée pour tous
  // les membres comparés ET que l'avance est nette.
  const distinctions: Distinction[] = [];
  if (ranked.length >= 2) {
    for (const d of DISTINCTIONS) {
      const vals = ranked.map((e) => ({ e, c: e.components.find((c) => c.key === d.key) }));
      if (vals.some((v) => !v.c?.available || v.c.score == null)) continue;
      vals.sort((a, b) => b.c!.score! - a.c!.score!);
      const [first, sec] = vals;
      if (first && sec && first.c!.score! - sec.c!.score! >= cfg.distinctionLead && first.c!.score! >= 6) {
        distinctions.push({ key: d.key, label: d.label, userId: first.e.userId, reason: `${COMPONENT_LABELS[d.key]} : ${first.c!.score}/10 contre ${sec.c!.score}/10.` });
      }
    }
    const prog = ranked.filter((e) => e.progressionDelta != null);
    if (prog.length >= 2) {
      prog.sort((a, b) => b.progressionDelta! - a.progressionDelta!);
      const p = prog[0]!;
      if (p.progressionDelta! >= 0.5)
        distinctions.push({ key: "progression", label: "Progression", userId: p.userId, reason: `+${p.progressionDelta} par rapport à sa moyenne habituelle.` });
    }
  }
  return { mvpUserIds: mvps.map((m) => m.userId), isTie, ranking, excluded, explanation, distinctions };
}
