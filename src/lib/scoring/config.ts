// Configuration figée de la note CoachGG. Toute modification des repères ou
// pondérations DOIT créer une nouvelle version (les anciennes notes restent
// associées à leur version et ne sont jamais recalculées silencieusement).
//
// IMPORTANT : les repères ci-dessous sont des heuristiques internes v1, choisies
// pour être raisonnables. Ils ne proviennent PAS d'un échantillon statistique
// de joueurs ; l'interface l'indique. Ils devront être recalibrés sur des
// données réelles (avec source et taille d'échantillon) avant de quitter le
// statut expérimental.

export type Role = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
export type ComponentKey = "resources" | "participation" | "damage" | "risk" | "vision" | "objectives";

export type Anchor = { floor: number; excellent: number }; // valeur → 0 au plancher, 10 à « excellent »

export type ScoreConfig = {
  version: string;
  experimental: boolean;
  description: string;
  minAvailableWeight: number;
  shortGameSec: number;
  tieThreshold: number; // écart de note sous lequel deux joueurs sont à égalité
  distinctionLead: number; // avance minimale pour une distinction secondaire
  weights: Record<Role | "UNKNOWN", Record<ComponentKey, number>>;
  anchors: {
    csPerMin: Record<Role | "UNKNOWN", Anchor>;
    killParticipation: Anchor;
    damageShare: Record<Role | "UNKNOWN", Anchor>;
    deathsPer10: Anchor;
    visionPerMin: Record<Role | "UNKNOWN", Anchor>;
    objectiveDamageShare: Record<Role | "UNKNOWN", Anchor>;
  };
};

export const SCORE_V1: ScoreConfig = {
  version: "perf-1.0.0",
  experimental: true,
  description:
    "Note de performance v1 : moyenne pondérée par rôle de 6 dimensions mesurables (ressources, participation, dégâts, gestion du risque, vision, objectifs). Le résultat (victoire/défaite) n'entre pas dans la note.",
  minAvailableWeight: 0.6,
  shortGameSec: 15 * 60,
  tieThreshold: 0.3,
  distinctionLead: 1.0,
  weights: {
    TOP: { resources: 0.22, participation: 0.15, damage: 0.2, risk: 0.2, vision: 0.08, objectives: 0.15 },
    JUNGLE: { resources: 0.12, participation: 0.23, damage: 0.13, risk: 0.17, vision: 0.13, objectives: 0.22 },
    MIDDLE: { resources: 0.22, participation: 0.18, damage: 0.22, risk: 0.18, vision: 0.08, objectives: 0.12 },
    BOTTOM: { resources: 0.25, participation: 0.15, damage: 0.25, risk: 0.18, vision: 0.07, objectives: 0.1 },
    UTILITY: { resources: 0.03, participation: 0.27, damage: 0.1, risk: 0.2, vision: 0.3, objectives: 0.1 },
    UNKNOWN: { resources: 1 / 6, participation: 1 / 6, damage: 1 / 6, risk: 1 / 6, vision: 1 / 6, objectives: 1 / 6 },
  },
  anchors: {
    csPerMin: {
      TOP: { floor: 4, excellent: 8.5 },
      JUNGLE: { floor: 3.5, excellent: 7 },
      MIDDLE: { floor: 4.5, excellent: 9 },
      BOTTOM: { floor: 5, excellent: 9.5 },
      UTILITY: { floor: 0.3, excellent: 2 },
      UNKNOWN: { floor: 3, excellent: 8.5 },
    },
    killParticipation: { floor: 0.25, excellent: 0.75 },
    damageShare: {
      TOP: { floor: 0.1, excellent: 0.3 },
      JUNGLE: { floor: 0.08, excellent: 0.25 },
      MIDDLE: { floor: 0.12, excellent: 0.32 },
      BOTTOM: { floor: 0.14, excellent: 0.35 },
      UTILITY: { floor: 0.03, excellent: 0.15 },
      UNKNOWN: { floor: 0.08, excellent: 0.3 },
    },
    deathsPer10: { floor: 4, excellent: 0.8 },
    visionPerMin: {
      TOP: { floor: 0.3, excellent: 1.2 },
      JUNGLE: { floor: 0.5, excellent: 1.6 },
      MIDDLE: { floor: 0.3, excellent: 1.2 },
      BOTTOM: { floor: 0.3, excellent: 1.2 },
      UTILITY: { floor: 1, excellent: 3 },
      UNKNOWN: { floor: 0.3, excellent: 1.5 },
    },
    objectiveDamageShare: {
      TOP: { floor: 0.1, excellent: 0.35 },
      JUNGLE: { floor: 0.15, excellent: 0.45 },
      MIDDLE: { floor: 0.08, excellent: 0.3 },
      BOTTOM: { floor: 0.12, excellent: 0.4 },
      UTILITY: { floor: 0.02, excellent: 0.12 },
      UNKNOWN: { floor: 0.08, excellent: 0.35 },
    },
  },
};

export const CURRENT_SCORE_CONFIG = SCORE_V1;

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  resources: "Ressources (farm)",
  participation: "Participation aux éliminations",
  damage: "Part des dégâts aux champions",
  risk: "Gestion du risque (morts / 10 min)",
  vision: "Vision",
  objectives: "Contribution aux objectifs",
};

export const COMPONENT_DEFINITIONS: Record<ComponentKey, string> = {
  resources: "Sbires et monstres tués par minute (creep score / durée).",
  participation: "(Éliminations + assistances) / éliminations totales de l'équipe.",
  damage: "Dégâts infligés aux champions / dégâts totaux de l'équipe.",
  risk: "Nombre de morts ramené à 10 minutes. Indicateur statistique : il ne dit pas POURQUOI la mort a eu lieu (une mort n'est pas forcément une erreur).",
  vision: "Score de vision par minute (balises posées, détruites, zones révélées).",
  objectives: "Dégâts aux objectifs (tours, dragons, Nashor…) / total de l'équipe.",
};
