// « Ce qu'il te faut pour le rang suivant » : écarts entre ton profil (note CoachGG par dimension)
// et des REPÈRES ESTIMÉS par rang. Riot ne publie pas de moyennes par rang : ces repères sont des
// heuristiques internes, affichées comme telles, à recalibrer sur de vraies données.
import type { ComponentKey } from "@/lib/scoring/config";

export const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_FR: Record<Tier, string> = {
  IRON: "Fer", BRONZE: "Bronze", SILVER: "Argent", GOLD: "Or", PLATINUM: "Platine", EMERALD: "Émeraude",
  DIAMOND: "Diamant", MASTER: "Maître", GRANDMASTER: "Grand maître", CHALLENGER: "Challenger",
};

/** Repère estimé (note /10) attendu par dimension au rang visé. */
export function targetFor(tier: Tier, key: ComponentKey): number {
  const base = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5][TIERS.indexOf(tier)]!;
  const adj: Partial<Record<ComponentKey, number>> = { risk: 0.5, vision: 0 }; // survivre compte un peu plus à chaque palier
  return Math.min(9.5, base + (adj[key] ?? 0));
}

export function nextTier(t: Tier | null): Tier {
  if (!t) return "SILVER";
  const i = TIERS.indexOf(t);
  return TIERS[Math.min(TIERS.length - 1, i + 1)]!;
}

export type SkillTip = { key: ComponentKey; title: string; why: string; tips: string[]; mouse: string[]; categories: string[] };

export const SKILL_TIPS: Record<ComponentKey, Omit<SkillTip, "key">> = {
  resources: {
    title: "Mieux farmer",
    why: "L'or des sbires est ta source de puissance la plus fiable : 15 sbires ≈ un kill.",
    tips: ["Vise 7 CS/min : compte tes sbires à 10 min (objectif 70).", "Ne quitte pas ta vague pour un combat perdu d'avance : la vague, c'est de l'or garanti.", "Entre deux actions, ramasse les vagues des voies latérales."],
    mouse: ["Dernier coup : attends que la barre de vie du sbire soit sous tes dégâts, puis clic droit dessus — pas avant.", "Active « Cibler les champions uniquement » (touche dédiée) pour ne pas viser un sbire par erreur en combat.", "Garde le curseur proche de ton champion entre les coups : moins de distance = clics plus précis."],
    categories: ["RESOURCES"],
  },
  participation: {
    title: "Être présent dans les combats",
    why: "Les parties se gagnent à plusieurs : rater les combats, c'est laisser ton équipe à 4 contre 5.",
    tips: ["Quand un objectif (dragon, héraut, baron) apparaît dans 1 min, pousse ta vague puis rejoins.", "Regarde la minimap toutes les 5 secondes pour voir où ton équipe va.", "Pingue avant d'arriver : tes alliés attendent ou engagent au bon moment."],
    mouse: ["Déplace-toi avec des clics droits courts et réguliers, pas un seul clic lointain : tu peux corriger ta trajectoire.", "Clic sur la minimap pour te déplacer sans bouger la caméra pendant une rotation."],
    categories: ["ENGAGEMENT", "ALLY_SUPPORT", "ROTATIONS"],
  },
  damage: {
    title: "Faire plus de dégâts en combat",
    why: "Tes dégâts décident si ton équipe gagne l'échange.",
    tips: ["Frappe la cible la plus proche que tu peux atteindre en sécurité, pas forcément la plus fragile.", "Garde ton sort principal pour quand l'ennemi a utilisé le sien.", "Pendant les échanges en voie, attaque quand l'ennemi fait un dernier coup."],
    mouse: ["Kite avec l'attaque-déplacement (touche A + clic gauche) : tu frappes l'ennemi le plus proche du curseur sans cliquer dessus exactement.", "Entre deux auto-attaques, un clic droit de recul : frapper, reculer, frapper.", "Utilise le lancement rapide des sorts : le sort part vers le curseur, vise avant d'appuyer."],
    categories: ["ABILITIES", "ENGAGEMENT"],
  },
  risk: {
    title: "Mourir moins",
    why: "Chaque mort donne de l'or à l'ennemi et te retire du jeu : c'est le levier le plus rapide pour monter.",
    tips: ["Avant d'avancer au-delà de la rivière, compte les ennemis visibles : s'il en manque 2, recule.", "Garde ton sort de fuite (Flash, dash) quand tu es en avant.", "Rentre à la base avant d'être à moitié vie si l'ennemi a plus de vie que toi."],
    mouse: ["Quand tu recules, clique loin derrière toi, vers ta tourelle, pas à côté de ton champion.", "Dès que la minimap montre un ennemi qui arrive, le premier réflexe est un clic droit vers l'arrière, avant même de réfléchir."],
    categories: ["POSITIONING", "MOVEMENT", "VISION"],
  },
  vision: {
    title: "Voir plus que l'ennemi",
    why: "La vision te dit où sont les ennemis : sans elle, chaque déplacement est un pari.",
    tips: ["Achète une balise de contrôle à chaque retour à la base.", "Pose ta balise avant d'entrer dans une zone sombre, pas après.", "Change ton bijou pour l'oracle (rouge) à partir du milieu de partie si tu es support ou jungler."],
    mouse: ["Balise en lancement rapide : vise le buisson avec le curseur, puis touche de balise — sans clic supplémentaire.", "Place la balise au bord du buisson côté ennemi pour voir plus loin."],
    categories: ["VISION"],
  },
  objectives: {
    title: "Prendre les objectifs",
    why: "Tours, dragons et baron donnent de l'or et des bonus à toute l'équipe : ils gagnent les parties.",
    tips: ["Après un kill ou un combat gagné, enchaîne sur l'objectif le plus proche au lieu de rentrer.", "Pousse ta vague avant un dragon pour arriver le premier.", "Frappe la tour dès que ta vague y arrive et que l'ennemi n'est pas là."],
    mouse: ["Sur un objectif, clic droit sur le monstre puis ne bouge plus : chaque déplacement fait perdre des dégâts.", "En combat près d'un objectif, garde le curseur entre l'objectif et l'ennemi pour réagir dans les deux sens."],
    categories: ["ROTATIONS", "ENGAGEMENT"],
  },
};

export type PlanItem = SkillTip & { now: number | null; target: number; gap: number | null };

/** Dimensions triées de la plus en retard à la plus avancée par rapport au repère du rang visé. */
export function nextRankPlan(profile: { key: ComponentKey; avg: number }[], target: Tier): PlanItem[] {
  return (Object.keys(SKILL_TIPS) as ComponentKey[])
    .map((key) => {
      const now = profile.find((p) => p.key === key)?.avg ?? null;
      const t = targetFor(target, key);
      return { key, ...SKILL_TIPS[key], now, target: t, gap: now == null ? null : Math.round((t - now) * 10) / 10 };
    })
    .sort((a, b) => (b.gap ?? -99) - (a.gap ?? -99));
}
