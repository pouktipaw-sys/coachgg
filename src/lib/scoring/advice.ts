// Recommandations issues des STATISTIQUES (règles déterministes).
// Elles signalent une tendance chiffrée ; elles ne prétendent pas connaître le
// contexte des actions (placement, informations visibles) : c'est le rôle de
// l'analyse vidéo. Chaque recommandation l'indique.
import type { ComponentKey } from "./config";
import type { ScoreResult } from "./engine";

export type Level = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

export type StatAdvice = { key: ComponentKey; title: string; why: string; action: string; videoCheck: string };

const TEMPLATES: Record<ComponentKey, (lvl: Level) => Omit<StatAdvice, "key" | "why">> = {
  resources: (l) => ({
    title: "Sécuriser davantage de ressources",
    action:
      l === "BEGINNER"
        ? "Concentre-toi sur le dernier coup des sbires quand aucun combat n'est en cours."
        : l === "INTERMEDIATE"
          ? "Entre deux actions, retourne sur une vague ou un camp au lieu d'errer sans objectif."
          : "Planifie tes rappels et rotations autour des vagues pour limiter les sbires perdus.",
    videoCheck: "Repère dans la vidéo les moments sans sbire ni camp à proximité.",
  }),
  participation: (l) => ({
    title: "Être présent aux actions de l'équipe",
    action:
      l === "BEGINNER"
        ? "Regarde la minimap toutes les quelques secondes pour voir où se battent tes alliés."
        : "Anticipe les combats autour des objectifs et rapproche-toi avant qu'ils ne commencent.",
    videoCheck: "Vérifie en vidéo où tu étais lors des combats auxquels tu n'as pas participé : c'était peut-être un bon choix (farm, pression ailleurs).",
  }),
  damage: () => ({
    title: "Augmenter ton impact en combat",
    action: "Cherche des échanges quand tes compétences sont disponibles et que l'adversaire ne peut pas riposter pleinement.",
    videoCheck: "Observe en vidéo si tu étais à portée pendant les combats ou si tu restais trop loin.",
  }),
  risk: (l) => ({
    title: "Réduire les morts évitables",
    action:
      l === "BEGINNER"
        ? "Quand plusieurs ennemis disparaissent de la carte, recule vers ta tour."
        : "Avant d'avancer, vérifie la position connue de la jungle adverse et tes chemins de repli.",
    videoCheck: "Toutes les morts ne sont pas des erreurs : revois les 10 s précédant chaque mort pour juger le contexte.",
  }),
  vision: (l) => ({
    title: "Améliorer la vision",
    action: l === "BEGINNER" ? "Utilise ta balise dès qu'elle est disponible." : "Achète une balise de contrôle à chaque retour et place-la avant les objectifs.",
    videoCheck: "Repère en vidéo les zones où un ennemi est apparu sans avertissement.",
  }),
  objectives: () => ({
    title: "Participer davantage aux objectifs",
    action: "Après un combat gagné ou une élimination, convertis l'avantage en tour, dragon ou héraut.",
    videoCheck: "Regarde en vidéo ce que tu faisais pendant les prises d'objectifs de ton équipe.",
  }),
};

/** Trois priorités maximum, issues des dimensions les plus pénalisantes. */
export function statAdvice(score: ScoreResult, level: Level = "INTERMEDIATE"): StatAdvice[] {
  const weakest = score.components
    .filter((c) => c.available && c.score != null && c.score < 6)
    .sort((a, b) => (10 - b.score!) * b.weight - (10 - a.score!) * a.weight)
    .slice(0, 3);
  return weakest.map((c) => ({
    key: c.key,
    why: `${c.label} : ${c.display} (note ${c.score}/10).`,
    ...TEMPLATES[c.key](level),
  }));
}
