// Données du tableau de bord d'un groupe et rapport collectif (règles déterministes).
import { prisma } from "../db";
import { requireTeamMember, sharedRecordingWhere } from "../permissions";
import { syncTeamReports } from "../scores";
import { goalProgress } from "../goals";
import { COMPONENT_LABELS, CURRENT_SCORE_CONFIG, type ComponentKey } from "@/lib/scoring/config";

type Comp = { key: ComponentKey; score: number | null; available: boolean; display: string | null };

export async function teamDashboard(userId: string, teamId: string) {
  const membership = await requireTeamMember(userId, teamId);
  await syncTeamReports(teamId);
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: {
      memberships: { include: { user: { select: { id: true, displayName: true, gameIdentities: { where: { isPrimary: true } } } } }, orderBy: { joinedAt: "asc" } },
      invitations: { where: { status: "PENDING", expiresAt: { gt: new Date() } }, include: { invitee: { select: { displayName: true } } } },
      goals: { orderBy: { createdAt: "desc" } },
    },
  });
  const reports = await prisma.teamMatchReport.findMany({
    where: { teamId, scoreVersionId: CURRENT_SCORE_CONFIG.version },
    include: { match: { select: { id: true, gameStartAt: true, createdAt: true, durationSec: true, gameMode: true, participants: { select: { userId: true, win: true } } } } },
  });
  reports.sort((a, b) => (b.match.gameStartAt ?? b.match.createdAt).getTime() - (a.match.gameStartAt ?? a.match.createdAt).getTime());

  const names = new Map(team.memberships.map((m) => [m.userId, m.user.displayName]));
  const mvpCount = new Map<string, number>();
  for (const r of reports) for (const u of r.mvpUserIds) mvpCount.set(u, (mvpCount.get(u) ?? 0) + 1);
  const wins = reports.filter((r) => r.match.participants.find((p) => r.presentUserIds.includes(p.userId ?? ""))?.win).length;
  const goals = await Promise.all(team.goals.map(async (g) => ({ ...g, progress: await goalProgress(g) })));

  return {
    team,
    myRole: membership.role,
    reports: reports.map((r) => ({
      id: r.id,
      matchId: r.matchId,
      date: r.match.gameStartAt ?? r.match.createdAt,
      durationSec: r.match.durationSec,
      gameMode: r.match.gameMode,
      win: r.match.participants.find((p) => r.presentUserIds.includes(p.userId ?? ""))?.win ?? null,
      present: r.presentUserIds.map((u) => names.get(u) ?? "ancien membre"),
      mvp: r.mvpUserIds.map((u) => names.get(u) ?? "ancien membre"),
      isTie: r.isTie,
    })),
    stats: { commonMatches: reports.length, wins, mvpCount: [...mvpCount.entries()].map(([u, n]) => ({ name: names.get(u) ?? "ancien membre", n })).sort((a, b) => b.n - a.n) },
    goals,
  };
}

/** Détail d'une partie commune : tableau Joueur | Rôle | Note | Distinction | Détail + rapport collectif. */
export async function teamMatchDetail(userId: string, teamId: string, matchId: string) {
  await requireTeamMember(userId, teamId);
  const report = await prisma.teamMatchReport.findUnique({
    where: { teamId_matchId_scoreVersionId: { teamId, matchId, scoreVersionId: CURRENT_SCORE_CONFIG.version } },
  });
  if (!report) return null;
  const participants = await prisma.matchParticipant.findMany({
    where: { matchId, userId: { in: report.presentUserIds } },
    include: {
      statistics: true,
      scores: { where: { scoreVersionId: CURRENT_SCORE_CONFIG.version } },
      user: { select: { id: true, displayName: true, profile: { select: { shareStatsWithTeams: true } } } },
    },
  });
  // Moments vidéo : uniquement ceux des vidéos réellement partagées avec le groupe (ou à moi).
  const recordings = await prisma.recording.findMany({
    where: { matchId, OR: [{ ownerId: userId }, sharedRecordingWhere(userId)] },
    include: { recommendations: { orderBy: { decisionMs: "asc" }, select: { id: true, title: true, kind: true, decisionMs: true, advice: true, category: true } } },
  });
  const distinctions = report.distinctions as { key: string; label: string; userId: string; reason: string }[];
  const explanation = report.explanation as { text: string; ranking: { userId: string; overall: number }[]; excluded: { userId: string; reason: string }[] };

  const rows = participants.map((p) => {
    const sc = p.scores[0];
    const comps = (sc?.components ?? []) as unknown as Comp[];
    const shareStats = p.user?.profile?.shareStatsWithTeams !== false || p.userId === userId;
    return {
      userId: p.userId!,
      name: p.user?.displayName ?? "?",
      role: p.role,
      champion: p.championName,
      overall: sc?.overall ?? null,
      reliability: sc?.reliability ?? null,
      isMvp: report.mvpUserIds.includes(p.userId!),
      distinctions: distinctions.filter((d) => d.userId === p.userId),
      stats: shareStats ? p.statistics : null,
      positives: shareStats ? ((sc?.positives ?? []) as { text: string }[]) : [],
      priority: shareStats ? ((sc?.negatives ?? []) as { text: string }[])[0]?.text ?? null : null,
      components: shareStats ? comps : [],
      clips: recordings.filter((r) => r.ownerId === p.userId).flatMap((r) => r.recommendations.map((m) => ({ ...m, recordingId: r.id }))),
      hasVideo: recordings.some((r) => r.ownerId === p.userId),
    };
  });
  rows.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  return { report, explanation, rows, collective: collectiveReport(rows, recordings.flatMap((r) => r.recommendations.map((m) => ({ ...m, recordingId: r.id })))) };
}

/**
 * Rapport collectif : une réussite, un problème observable, une séquence à revoir, un objectif.
 * Basé uniquement sur les statistiques des membres présents et les moments vidéo partagés.
 * Aucune information sur les communications vocales n'est disponible ni supposée.
 */
export function collectiveReport(
  rows: { components: Comp[]; name: string }[],
  moments: { id: string; title: string; kind: string; decisionMs: number; recordingId: string }[],
) {
  const keys: ComponentKey[] = ["participation", "objectives", "vision", "risk", "resources", "damage"];
  const avgs = keys
    .map((k) => {
      const vals = rows.map((r) => r.components.find((c) => c.key === k)).filter((c) => c?.available && c.score != null).map((c) => c!.score!);
      return { key: k, avg: vals.length === rows.length && vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null };
    })
    .filter((x): x is { key: ComponentKey; avg: number } => x.avg != null);
  if (avgs.length === 0) return null;
  const best = [...avgs].sort((a, b) => b.avg - a.avg)[0]!;
  const worst = [...avgs].sort((a, b) => a.avg - b.avg)[0]!;
  const seq = moments.find((m) => m.kind === "MISTAKE" || m.kind === "FIGHT" || m.kind === "MISSED_OPPORTUNITY") ?? moments[0] ?? null;
  const goalText: Record<ComponentKey, string> = {
    participation: "Se regrouper avant les combats annoncés autour des objectifs.",
    objectives: "Convertir chaque combat gagné en objectif (tour, dragon, héraut).",
    vision: "Préparer la vision ensemble 1 minute avant chaque objectif neutre.",
    risk: "Ne pas avancer seul sans information sur la jungle adverse ; jouer groupé quand des ennemis manquent.",
    resources: "Laisser les vagues et camps disponibles à celui qui en a besoin entre deux actions.",
    damage: "Engager ensemble quand les compétences clés sont disponibles.",
  };
  return {
    success: { key: best.key, text: `${COMPONENT_LABELS[best.key]} : moyenne du groupe ${best.avg}/10.` },
    problem: worst.avg < 6 ? { key: worst.key, text: `${COMPONENT_LABELS[worst.key]} : moyenne du groupe ${worst.avg}/10.` } : null,
    sequence: seq,
    goal: worst.avg < 6 ? goalText[worst.key] : null,
    basis: `Calculé sur ${rows.length} membres présents, formule ${CURRENT_SCORE_CONFIG.version}. Les communications vocales ne sont pas connues de CoachGG.`,
  };
}
