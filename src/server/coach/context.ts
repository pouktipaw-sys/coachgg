// Données autorisées transmises au coach conversationnel.
//
// Règles :
//  • Uniquement ce que l'utilisateur peut déjà voir dans l'application (mêmes
//    contrôles d'accès) : ses matchs, les moments PUBLIÉS des vidéos qu'il
//    possède ou qui lui sont partagées, ses objectifs, les rapports des groupes
//    dont il est membre (statistiques détaillées selon le réglage de chaque membre).
//  • Les propositions automatiques non validées ne sont jamais utilisées.
//  • Chaque élément porte un identifiant citable et un lien vers sa source.
//  • Ordre déterministe (même données → même texte → cache de prompt efficace).
import { prisma } from "../db";
import { sharedRecordingWhere } from "../permissions";
import { teamMatchDetail } from "../teams/dashboard";
import { goalProgress } from "../goals";
import { COMPONENT_LABELS, CURRENT_SCORE_CONFIG, type ComponentKey } from "@/lib/scoring/config";
import { CATEGORY_LABELS, CONFIDENCE_LABELS, KIND_LABELS } from "@/lib/annotations/schema";
import { formatMs, gameTimeMs } from "@/lib/annotations/coaching";

export type SourceKind = "profile" | "match" | "moment" | "goal" | "trend" | "team_match";
export type Source = { id: string; kind: SourceKind; title: string; link: string | null; text: string };

type Comp = { key: ComponentKey; label: string; available: boolean; score: number | null; display: string | null; missingReason?: string };

export type CoachContext = {
  profile: { level: string; density: string; primaryRole: string | null; goal: string | null; source: Source };
  matches: {
    source: Source;
    date: Date;
    champion: string;
    role: string | null;
    win: boolean;
    overall: number | null;
    reliability: string | null;
    components: Comp[];
    positives: string[];
    negatives: string[];
    missing: string[];
  }[];
  moments: {
    source: Source;
    kind: string;
    category: string;
    title: string;
    advice: string;
    confidence: string;
    alternatives: { label: string; conditions: string; limits: string }[];
    hasAlternativePath: boolean;
    hasActualPath: boolean;
  }[];
  goals: { source: Source; title: string; status: string }[];
  trend: { source: Source; items: { key: ComponentKey; label: string; recent: number; previous: number | null; delta: number | null; n: number }[] } | null;
  teams: { source: Source; teamName: string; mvpText: string; problem: string | null; goal: string | null; sequenceLink: string | null }[];
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

export async function buildCoachContext(userId: string, opts: { teamId?: string | null } = {}): Promise<CoachContext> {
  const profile = await prisma.playerProfile.upsert({ where: { userId }, update: {}, create: { userId } });
  const profileSource: Source = {
    id: "profile",
    kind: "profile",
    title: "Profil",
    link: "/app/settings",
    text: `Rôle principal : ${profile.primaryRole ?? "non renseigné"} ; rôle secondaire : ${profile.secondaryRole ?? "—"} ; champions préférés : ${profile.favoriteChampions.join(", ") || "—"} ; objectif déclaré : ${profile.progressGoal ?? "—"} ; niveau d'explication : ${profile.explanationLevel} ; densité : ${profile.explanationDensity}.`,
  };

  // ── Matchs (participations de l'utilisateur, hors démo) ──
  const parts = await prisma.matchParticipant.findMany({
    where: { userId, match: { isDemo: false } },
    include: { match: true, statistics: true, scores: { where: { scoreVersionId: CURRENT_SCORE_CONFIG.version } } },
    orderBy: [{ match: { gameStartAt: "desc" } }, { match: { createdAt: "desc" } }],
    take: 20,
  });
  const matches = parts.slice(0, 10).map((p) => {
    const s = p.scores[0];
    const comps = ((s?.components ?? []) as Comp[]).map((c) => ({ ...c, label: COMPONENT_LABELS[c.key] ?? c.key }));
    const missing = ((s?.missingData as { items?: string[] } | null)?.items ?? []) as string[];
    const st = p.statistics;
    const date = p.match.gameStartAt ?? p.match.createdAt;
    const text = [
      `Match du ${fmtDate(date)} · ${p.championName} · rôle ${p.role ?? "inconnu"} · ${p.win ? "victoire" : "défaite"} · durée ${Math.round(p.match.durationSec / 60)} min · source ${p.match.source === "RIOT_API" ? "API Riot" : "saisie manuelle"}.`,
      st ? `K/D/A ${st.kills}/${st.deaths}/${st.assists} ; CS ${st.creepScore ?? "n.d."} ; vision ${st.visionScore ?? "n.d."} ; dégâts ${st.damageToChampions ?? "n.d."}.` : "Statistiques absentes.",
      s?.overall != null ? `Note CoachGG ${s.overall}/10 (formule ${CURRENT_SCORE_CONFIG.version}, expérimentale ; fiabilité ${s.reliability}).` : "Note non calculée (données insuffisantes).",
      comps.length ? `Dimensions : ${comps.map((c) => (c.available ? `${c.label} ${c.display} → ${c.score}/10` : `${c.label} non mesurée`)).join(" ; ")}.` : "",
      missing.length ? `Données manquantes : ${missing.join(" ; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      source: { id: `match:${p.matchId}`, kind: "match" as const, title: `Match du ${fmtDate(date)} (${p.championName})`, link: `/app/matches/${p.matchId}`, text },
      date,
      champion: p.championName,
      role: p.role,
      win: p.win,
      overall: s?.overall ?? null,
      reliability: s?.reliability ?? null,
      components: comps,
      positives: ((s?.positives ?? []) as { text: string }[]).map((x) => x.text),
      negatives: ((s?.negatives ?? []) as { text: string }[]).map((x) => x.text),
      missing,
    };
  });

  // ── Tendance personnelle : 10 dernières parties notées vs 10 précédentes ──
  const scored = parts.filter((p) => p.scores[0]?.overall != null);
  const avg = (rows: typeof scored, key: ComponentKey) => {
    const v = rows.map((r) => (r.scores[0]!.components as Comp[]).find((c) => c.key === key)).filter((c) => c?.available && c.score != null).map((c) => c!.score!);
    return v.length ? { value: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, n: v.length } : null;
  };
  const recentRows = scored.slice(0, 10);
  const prevRows = scored.slice(10, 20);
  const items = (Object.keys(COMPONENT_LABELS) as ComponentKey[])
    .map((key) => {
      const r = avg(recentRows, key);
      const pr = avg(prevRows, key);
      return r ? { key, label: COMPONENT_LABELS[key], recent: r.value, previous: pr?.value ?? null, delta: pr ? Math.round((r.value - pr.value) * 10) / 10 : null, n: r.n } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const trend = recentRows.length >= 2
    ? {
        source: {
          id: "trend:personal",
          kind: "trend" as const,
          title: "Tendance personnelle",
          link: "/app/progress",
          text: `Moyennes sur les ${recentRows.length} dernières parties notées${prevRows.length ? ` (comparées aux ${prevRows.length} précédentes)` : ""} : ${items.map((i) => `${i.label} ${i.recent}/10${i.delta != null ? ` (${i.delta >= 0 ? "+" : ""}${i.delta})` : ""}`).join(" ; ")}.`,
        },
        items,
      }
    : null;

  // ── Moments de coaching publiés, vidéos visibles par l'utilisateur ──
  const recs = await prisma.recommendation.findMany({
    where: { status: { in: ["PUBLISHED", "DISPUTED"] }, recording: { OR: [{ ownerId: userId }, sharedRecordingWhere(userId)] } },
    include: { observations: { orderBy: { createdAt: "asc" } }, annotations: { select: { type: true, style: true } }, recording: { select: { id: true, title: true, ownerId: true, gameStartOffsetMs: true, owner: { select: { displayName: true } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 30,
  });
  const moments = recs.map((r) => {
    const g = gameTimeMs(r.decisionMs, r.recording.gameStartOffsetMs);
    const alts = (r.alternatives ?? []) as { label: string; conditions: string; limits: string }[];
    const text = [
      `${KIND_LABELS[r.kind]} · ${CATEGORY_LABELS[r.category]} · « ${r.title} » · vidéo « ${r.recording.title} »${r.recording.ownerId !== userId ? ` (partagée par ${r.recording.owner.displayName})` : ""}.`,
      `Contexte ${formatMs(r.contextStartMs)} → décision ${formatMs(r.decisionMs)}${g != null && g >= 0 ? ` (temps de jeu ${formatMs(g)})` : ""} → fin ${formatMs(r.endMs)}.`,
      `Observations : ${r.observations.map((o) => o.text).join(" | ")}.`,
      r.interpretation ? `Interprétation : ${r.interpretation}` : "",
      alts.length ? `Alternatives proposées : ${alts.map((a) => `${a.label}${a.conditions ? ` (si ${a.conditions})` : ""}${a.limits ? ` [limites : ${a.limits}]` : ""}`).join(" ; ")}.` : "",
      `Confiance : ${CONFIDENCE_LABELS[r.confidence]} — ${r.confidenceReason}.`,
      r.advice ? `Conseil : ${r.advice}` : "",
      `Provenance : ${r.provenance === "MANUAL" ? "annotation manuelle" : `analyse automatique validée (${r.analysisVersion})`}${r.status === "DISPUTED" ? " ; contesté par un utilisateur" : ""}.`,
      r.annotations.length ? `Annotations : ${r.annotations.map((a) => `${a.type}/${a.style}`).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      source: { id: `moment:${r.id}`, kind: "moment" as const, title: `${r.title} (${formatMs(r.decisionMs)})`, link: `/app/videos/${r.recording.id}?t=${r.contextStartMs}`, text },
      kind: r.kind,
      category: r.category,
      title: r.title,
      advice: r.advice,
      confidence: r.confidence,
      alternatives: alts,
      hasAlternativePath: r.annotations.some((a) => a.type === "path" && a.style === "alternative"),
      hasActualPath: r.annotations.some((a) => a.type === "path" && a.style === "actual"),
    };
  });

  // ── Objectifs ──
  const goalRows = await prisma.goal.findMany({ where: { ownerId: userId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 10 });
  const goals = await Promise.all(
    goalRows.map(async (g) => {
      const p = await goalProgress(g);
      return {
        source: {
          id: `goal:${g.id}`,
          kind: "goal" as const,
          title: `Objectif : ${g.title}`,
          link: "/app/goals",
          text: `Objectif « ${g.title} » (${g.status}) du ${fmtDate(g.periodStart)} au ${g.periodEnd ? fmtDate(g.periodEnd) : "—"}. ${g.reason ? `Raison : ${g.reason}. ` : ""}${g.expectedBehavior ? `Comportement attendu : ${g.expectedBehavior}. ` : ""}${p ? `Bilan : ${p.met}/${p.matches} partie(s) avec ${p.label}.` : "Sans indicateur chiffré."}`,
        },
        title: g.title,
        status: g.status,
      };
    }),
  );

  // ── Groupes : dernier rapport commun par groupe (droits vérifiés par teamMatchDetail) ──
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, ...(opts.teamId ? { teamId: opts.teamId } : {}) },
    include: { team: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });
  const teams: CoachContext["teams"] = [];
  for (const m of memberships) {
    const last = await prisma.teamMatchReport.findFirst({
      where: { teamId: m.teamId, scoreVersionId: CURRENT_SCORE_CONFIG.version },
      include: { match: { select: { gameStartAt: true, createdAt: true } } },
      orderBy: { computedAt: "desc" },
    });
    if (!last) continue;
    const d = await teamMatchDetail(userId, m.teamId, last.matchId);
    if (!d) continue;
    const date = last.match.gameStartAt ?? last.match.createdAt;
    const rows = d.rows.map((r) => `${r.name} (${r.role ?? "rôle inconnu"}) ${r.overall != null ? `${r.overall}/10` : "sans note"}${r.distinctions.length ? ` — ${r.distinctions.map((x) => x.label).join(", ")}` : ""}`).join(" ; ");
    teams.push({
      source: {
        id: `team:${m.teamId}:${last.matchId}`,
        kind: "team_match",
        title: `Groupe ${m.team.name} — partie du ${fmtDate(date)}`,
        link: `/app/teams/${m.teamId}?match=${last.matchId}`,
        text: [
          `Groupe « ${m.team.name} », partie commune du ${fmtDate(date)}. Membres présents : ${rows}.`,
          `MVP du groupe : ${d.explanation.text}`,
          d.collective
            ? `Rapport collectif : réussite — ${d.collective.success.text} ; problème — ${d.collective.problem?.text ?? "aucun sous 6/10"} ; objectif — ${d.collective.goal ?? "maintenir"}. ${d.collective.basis}`
            : "Rapport collectif indisponible (données insuffisantes).",
        ].join(" "),
      },
      teamName: m.team.name,
      mvpText: d.explanation.text,
      problem: d.collective?.problem?.text ?? null,
      goal: d.collective?.goal ?? null,
      sequenceLink: d.collective?.sequence ? `/app/videos/${d.collective.sequence.recordingId}?t=${d.collective.sequence.decisionMs}` : null,
    });
  }

  return {
    profile: { level: profile.explanationLevel, density: profile.explanationDensity, primaryRole: profile.primaryRole, goal: profile.progressGoal, source: profileSource },
    matches,
    moments,
    goals,
    trend,
    teams,
  };
}

export function allSources(ctx: CoachContext): Source[] {
  return [ctx.profile.source, ...(ctx.trend ? [ctx.trend.source] : []), ...ctx.matches.map((m) => m.source), ...ctx.moments.map((m) => m.source), ...ctx.goals.map((g) => g.source), ...ctx.teams.map((t) => t.source)];
}

/** Bloc de données transmis au modèle (texte stable et délimité). */
export function renderSources(sources: Source[]): string {
  return [
    "<donnees_autorisees>",
    ...sources.map((s) => `<source id="${s.id}" type="${s.kind}" titre="${s.title.replace(/"/g, "'")}">\n${s.text}\n</source>`),
    "</donnees_autorisees>",
  ].join("\n");
}
