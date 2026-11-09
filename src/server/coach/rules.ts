// Coach en mode « règles » : réponses déterministes, sans modèle de langage,
// toujours sourcées. Sert de mode par défaut quand l'IA n'est pas configurée et
// de repli quand elle échoue.
import type { CoachContext } from "./context";

export type CoachAnswer = {
  answer: string;
  citations: { sourceId: string; quote?: string }[];
  missingInformation: string[];
  followUps: string[];
};

export type Intent = "why_score" | "positioning" | "best_action" | "trajectory" | "next_focus" | "group" | "unknown";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function detectIntent(question: string): Intent {
  const q = norm(question);
  if (/(groupe|equipe|team|ensemble|nos parties|notre)/.test(q)) return "group";
  if (/(trajectoire|trajet|chemin|deplacement)/.test(q)) return "trajectory";
  if (/(placement|position|placer|mal place)/.test(q)) return "positioning";
  if (/(meilleure? action|alternative|aurais[- ]?je du|qu.aurais|autre decision|mieux faire)/.test(q)) return "best_action";
  if (/(note|score|pourquoi.*(\d|sur 10)|evaluation)/.test(q)) return "why_score";
  if (/(travailler|ensuite|progresser|ameliorer|priorite|objectif|focus)/.test(q)) return "next_focus";
  return "unknown";
}

const RELIABILITY_FR: Record<string, string> = { high: "élevée", medium: "moyenne", low: "faible", insufficient: "insuffisante" };

const FOLLOW_UPS = ["Pourquoi cette note ?", "Quelles erreurs de placement ?", "Quelle meilleure action ?", "Que travailler ensuite ?", "Que doit améliorer notre groupe ?"];

export function answerWithRules(question: string, ctx: CoachContext): CoachAnswer {
  const intent = detectIntent(question);
  const follow = (exclude: string) => FOLLOW_UPS.filter((f) => f !== exclude).slice(0, 3);

  switch (intent) {
    case "why_score": {
      const m = ctx.matches.find((x) => x.overall != null) ?? ctx.matches[0];
      if (!m) return { answer: "Je n'ai aucun match enregistré pour expliquer une note.", citations: [], missingInformation: ["Aucun match : ajoutez une partie (saisie manuelle ou import Riot)."], followUps: follow("Pourquoi cette note ?") };
      if (m.overall == null)
        return {
          answer: `Votre dernier match (${m.champion}) n'a pas de note : trop de données manquent pour un calcul fiable.`,
          citations: [{ sourceId: m.source.id }],
          missingInformation: m.missing.length ? m.missing : ["Statistiques insuffisantes pour ce match."],
          followUps: follow("Pourquoi cette note ?"),
        };
      const best = m.components.filter((c) => c.available).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const top = best.slice(0, 2).map((c) => `${c.label} (${c.display}, ${c.score}/10)`);
      const low = best.slice(-2).reverse().filter((c) => (c.score ?? 10) < 6).map((c) => `${c.label} (${c.display}, ${c.score}/10)`);
      return {
        answer: [
          `Votre dernière note est ${m.overall}/10 (${m.champion}, ${m.win ? "victoire" : "défaite"}, fiabilité ${RELIABILITY_FR[m.reliability ?? ""] ?? "inconnue"}).`,
          `C'est une moyenne pondérée selon votre rôle de dimensions mesurées ; le résultat du match n'en fait pas partie.`,
          top.length ? `Ce qui la tire vers le haut : ${top.join(" et ")}.` : "",
          low.length ? `Ce qui la tire vers le bas : ${low.join(" et ")}.` : "",
          m.missing.length ? `Attention, des données manquent : la note est calculée sans elles.` : "",
        ].filter(Boolean).join(" "),
        citations: [{ sourceId: m.source.id }],
        missingInformation: m.missing,
        followUps: follow("Pourquoi cette note ?"),
      };
    }
    case "positioning": {
      const ms = ctx.moments.filter((m) => m.category === "POSITIONING" || m.category === "MOVEMENT" || m.category === "ENGAGEMENT");
      if (!ms.length)
        return {
          answer: "Je ne peux pas identifier d'erreur de placement : aucun moment vidéo validé ne porte sur le placement ou les déplacements. Les statistiques seules ne permettent pas d'établir une erreur de placement.",
          citations: [],
          missingInformation: ["Aucun moment de coaching validé en catégorie placement, déplacements ou engagement."],
          followUps: ["Que travailler ensuite ?", "Pourquoi cette note ?"],
        };
      const list = ms.slice(0, 3);
      return {
        answer: `Moments analysés sur votre placement : ${list.map((m) => `« ${m.title} »${m.advice ? ` — conseil : ${m.advice}` : ""} (confiance : ${m.confidence.toLowerCase()})`).join(" ; ")}.`,
        citations: list.map((m) => ({ sourceId: m.source.id })),
        missingInformation: list.some((m) => m.confidence === "INCONCLUSIVE") ? ["Certains moments sont marqués « le contexte ne permet pas de conclure »."] : [],
        followUps: follow("Quelles erreurs de placement ?"),
      };
    }
    case "best_action": {
      const ms = ctx.moments.filter((m) => m.alternatives.length > 0).slice(0, 3);
      if (!ms.length)
        return { answer: "Aucun moment validé ne propose d'alternative pour l'instant.", citations: [], missingInformation: ["Aucune alternative enregistrée dans vos moments de coaching."], followUps: follow("Quelle meilleure action ?") };
      return {
        answer: `Alternatives proposées dans vos moments (ce sont des propositions, pas des certitudes) : ${ms.map((m) => `« ${m.title} » → ${m.alternatives.map((a) => `${a.label}${a.conditions ? ` (si ${a.conditions})` : ""}`).join(" ou ")}`).join(" ; ")}.`,
        citations: ms.map((m) => ({ sourceId: m.source.id })),
        missingInformation: [],
        followUps: follow("Quelle meilleure action ?"),
      };
    }
    case "trajectory": {
      const ms = ctx.moments.filter((m) => m.hasAlternativePath || m.hasActualPath).slice(0, 3);
      if (!ms.length)
        return { answer: "Aucun moment validé ne contient de trajectoire annotée.", citations: [], missingInformation: ["Aucune trajectoire (réelle ou alternative) annotée dans vos vidéos."], followUps: follow("") };
      return {
        answer: `Trajectoires annotées : ${ms.map((m) => `« ${m.title} »${m.hasActualPath ? " (trajet réel en rouge)" : ""}${m.hasAlternativePath ? " (alternative en vert)" : ""}${m.alternatives[0] ? ` — raison de l'alternative : ${m.alternatives[0].label}${m.alternatives[0].conditions ? `, si ${m.alternatives[0].conditions}` : ""}` : ""}`).join(" ; ")}. Ouvrez le clip pour voir l'animation.`,
        citations: ms.map((m) => ({ sourceId: m.source.id })),
        missingInformation: [],
        followUps: follow(""),
      };
    }
    case "next_focus": {
      const weak = (ctx.trend?.items ?? []).filter((i) => i.recent < 6).sort((a, b) => a.recent - b.recent).slice(0, 2);
      const active = ctx.goals.find((g) => g.status === "ACTIVE");
      const advices = ctx.moments.filter((m) => m.advice).slice(0, 2);
      const cites = [...(weak.length && ctx.trend ? [{ sourceId: ctx.trend.source.id }] : []), ...(active ? [{ sourceId: active.source.id }] : []), ...advices.map((m) => ({ sourceId: m.source.id }))];
      if (!cites.length)
        return { answer: "Je manque de données pour proposer une priorité.", citations: [], missingInformation: ["Au moins deux parties notées ou un moment de coaching validé sont nécessaires."], followUps: follow("Que travailler ensuite ?") };
      return {
        answer: [
          weak.length ? `Priorité statistique : ${weak.map((w) => `${w.label} (moyenne ${w.recent}/10 sur ${w.n} parties)`).join(", ")}.` : "",
          active ? `Votre objectif en cours : « ${active.title} ».` : "",
          advices.length ? `Conseils tirés de vos vidéos : ${advices.map((m) => m.advice).join(" ; ")}.` : "",
        ].filter(Boolean).join(" "),
        citations: cites,
        missingInformation: [],
        followUps: follow("Que travailler ensuite ?"),
      };
    }
    case "group": {
      const t = ctx.teams[0];
      if (!t)
        return { answer: "Je n'ai aucune partie commune de groupe à analyser.", citations: [], missingInformation: ["Aucune partie commune (au moins deux membres d'un même groupe dans un match)."], followUps: follow("Que doit améliorer notre groupe ?") };
      return {
        answer: [
          `Dernière partie commune du groupe « ${t.teamName} » : ${t.mvpText}`,
          t.problem ? `Point à améliorer ensemble : ${t.problem}.` : "Aucune dimension commune sous 6/10.",
          t.goal ? `Objectif collectif proposé : ${t.goal}` : "",
          "Je ne connais pas vos communications vocales.",
        ].filter(Boolean).join(" "),
        citations: [{ sourceId: t.source.id }],
        missingInformation: t.sequenceLink ? [] : ["Aucune vidéo de cette partie partagée avec le groupe."],
        followUps: follow("Que doit améliorer notre groupe ?"),
      };
    }
    default:
      return {
        answer: "En mode sans IA, je réponds à des questions précises sur vos données : votre note, vos erreurs de placement analysées, les alternatives proposées, les trajectoires annotées, vos priorités, ou votre groupe.",
        citations: [],
        missingInformation: ["Question non reconnue par le mode sans IA (le mode IA n'est pas configuré ou a échoué)."],
        followUps: FOLLOW_UPS.slice(0, 4),
      };
  }
}
