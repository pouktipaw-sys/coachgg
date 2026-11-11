import Link from "next/link";
import { Badge, EmptyState, PageHeader, RECORDING_STATUS } from "@/components/ui";
import { ROLE_LABELS, ScorePill, Sparkline, formatRank, type RankEntry } from "@/components/stats";
import { integrationStatus } from "@/lib/env";
import { requirePageUser } from "@/server/auth/page";
import { autoSyncIfDue } from "@/server/riot/import";
import { prisma } from "@/server/db";
import { listUserMatches, parseMatchFilters } from "@/server/matches/queries";
import { goalProgress } from "@/server/goals";
import { COMPONENT_LABELS, CURRENT_SCORE_CONFIG, type ComponentKey } from "@/lib/scoring/config";
import { formatMs } from "@/lib/annotations/coaching";
import { KIND_LABELS } from "@/lib/annotations/schema";

export const metadata = { title: "Tableau de bord" };

export default async function Dashboard() {
  const user = await requirePageUser();
  await autoSyncIfDue(user.id).catch(() => null);
  const [profile, identity, matches, recordings, moments, goal, teams, jobs, scores] = await Promise.all([
    prisma.playerProfile.findUnique({ where: { userId: user.id } }),
    prisma.gameIdentity.findFirst({ where: { userId: user.id, isPrimary: true } }),
    listUserMatches(user.id, parseMatchFilters({}), 20),
    prisma.recording.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.recommendation.findMany({
      where: { recording: { ownerId: user.id }, status: { in: ["PUBLISHED", "DISPUTED"] } },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, title: true, kind: true, decisionMs: true, recordingId: true, advice: true, provenance: true },
    }),
    prisma.goal.findFirst({ where: { ownerId: user.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
    prisma.team.findMany({ where: { memberships: { some: { userId: user.id } } }, select: { id: true, name: true, _count: { select: { reports: true } } } }),
    prisma.analysisJob.groupBy({ by: ["status"], where: { recording: { ownerId: user.id }, status: { in: ["PENDING", "RUNNING", "FAILED"] } }, _count: { _all: true } }),
    prisma.performanceScore.findMany({
      where: { scoreVersionId: CURRENT_SCORE_CONFIG.version, overall: { not: null }, participant: { userId: user.id, match: { isDemo: false } } },
      include: { participant: { select: { match: { select: { gameStartAt: true, createdAt: true } } } } },
    }),
  ]);
  const goalProg = goal ? await goalProgress(goal) : null;
  const drafts = await prisma.recommendation.groupBy({
    by: ["recordingId"],
    where: { recording: { ownerId: user.id }, provenance: "AUTOMATIC", status: "DRAFT" },
    _count: { _all: true },
  });
  const draftCount = drafts.reduce((a, d) => a + d._count._all, 0);
  const devices = await prisma.device.findMany({ where: { userId: user.id, revokedAt: null }, select: { lastSeenAt: true, status: true } });
  const online = devices.filter((d) => d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 2 * 60_000);
  const recordingNow = online.some((d) => (d.status as { state?: string } | null)?.state === "recording");

  const series = scores
    .map((s) => ({ date: s.participant.match.gameStartAt ?? s.participant.match.createdAt, value: s.overall!, comps: s.components as { key: ComponentKey; score: number | null; available: boolean }[] }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-15);
  const last10 = series.slice(-10);
  // Priorités : dimensions les plus faibles en moyenne sur les 10 dernières parties notées (max 3).
  const agg = new Map<ComponentKey, number[]>();
  for (const s of last10) for (const c of s.comps) if (c.available && c.score != null) agg.set(c.key, [...(agg.get(c.key) ?? []), c.score]);
  const priorities = [...agg.entries()]
    .map(([k, v]) => ({ key: k, avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, n: v.length }))
    .filter((p) => p.avg < 6 && p.n >= 2)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3);
  const lastMatch = matches[0];
  const jobCount = (s: string) => jobs.find((j) => j.status === s)?._count._all ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bonjour ${user.displayName}`}
        subtitle={
          <span>
            {identity ? `${identity.gameName}#${identity.tagLine} · ${identity.platform} (déclaré)` : <Link className="underline" href="/app/settings#identite">Associer un Riot ID</Link>}
            {profile?.primaryRole ? ` · ${ROLE_LABELS[profile.primaryRole]}` : ""}
            {" · "}
            {Array.isArray(identity?.rank) && (identity!.rank as RankEntry[]).length
              ? (identity!.rank as RankEntry[]).map(formatRank).join(" · ")
              : integrationStatus().riotApi === "configured"
                ? "Rang : à récupérer dans Paramètres"
                : "Rang : non disponible (clé API Riot non configurée)"}
          </span>
        }
        actions={
          <>
            <Link href="/app/videos/upload" className="btn-primary">Importer une vidéo</Link>
            <Link href="/app/matches/new" className="btn-ghost">Ajouter un match</Link>
          </>
        }
      />

      {!profile?.onboardingCompletedAt && (
        <div className="card border-accent/40">
          <p className="font-medium">Terminez votre profil</p>
          <p className="text-sm text-muted">Rôle, champions, objectif et niveau d&apos;explication adaptent les conseils.</p>
          <Link href="/app/onboarding" className="btn-primary mt-3">Configurer</Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card">
          <h2 className="h2">Note récente</h2>
          {lastMatch ? (
            <div className="mt-2">
              <div className="flex items-center gap-3">
                <ScorePill score={lastMatch.me.score} reliability={lastMatch.me.reliability} />
                <Link className="text-sm underline" href={`/app/matches/${lastMatch.id}`}>
                  {lastMatch.me.championName} · {lastMatch.me.win ? "Victoire" : "Défaite"} · {new Date(lastMatch.date).toLocaleDateString("fr-FR")}
                </Link>
              </div>
              <div className="mt-4"><Sparkline values={series.map((s) => ({ label: s.date.toLocaleDateString("fr-FR"), value: s.value }))} /></div>
              <p className="mt-1 text-xs text-muted">Évolution de la note (formule {CURRENT_SCORE_CONFIG.version}, expérimentale).</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Aucun match. <Link className="underline" href="/app/matches/new">Ajoutez votre première partie</Link>.</p>
          )}
        </section>

        <section className="card">
          <h2 className="h2">Trois priorités</h2>
          {priorities.length ? (
            <ol className="mt-2 space-y-2 text-sm">
              {priorities.map((p, i) => (
                <li key={p.key}>{i + 1}. {COMPONENT_LABELS[p.key]} <span className="text-muted">— moyenne {p.avg}/10 sur {p.n} parties</span></li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted">{series.length < 2 ? "Au moins deux parties notées sont nécessaires." : "Aucune dimension durablement sous 6/10."}</p>
          )}
        </section>

        <section className="card">
          <h2 className="h2">Objectif actif</h2>
          {goal ? (
            <div className="mt-2 text-sm">
              <p className="font-medium">{goal.title}</p>
              {goalProg && <p className="text-muted">{goalProg.label} : {goalProg.met}/{goalProg.matches} partie(s)</p>}
              <Link className="mt-2 inline-block text-xs underline" href="/app/goals">Gérer mes objectifs</Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Aucun. <Link className="underline" href="/app/goals">Définir un objectif</Link>.</p>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between"><h2 className="h2">Dernières parties</h2><Link className="text-sm underline" href="/app/matches">Historique</Link></div>
          {matches.length === 0 ? <div className="mt-3"><EmptyState title="Aucune partie" /></div> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {matches.slice(0, 5).map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2">
                  <Link className="hover:underline" href={`/app/matches/${m.id}`}>
                    <span className={m.me.win ? "text-win" : "text-loss"}>{m.me.win ? "V" : "D"}</span> · {m.me.championName} · {m.me.kills}/{m.me.deaths}/{m.me.assists}
                    {m.friends.length > 0 && <span className="text-xs text-muted"> · avec {m.friends.join(", ")}</span>}
                  </Link>
                  <ScorePill score={m.me.score} reliability={m.me.reliability} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between"><h2 className="h2">Derniers moments de coaching</h2><Link className="text-sm underline" href="/app/videos">Vidéos</Link></div>
          {moments.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Aucun moment. Ouvrez une vidéo prête et ajoutez un moment.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {moments.map((m) => (
                <li key={m.id}>
                  <Link className="hover:underline" href={`/app/videos/${m.recordingId}`}>{formatMs(m.decisionMs)} — {m.title}</Link>
                  <span className="ml-2 text-xs text-muted">{KIND_LABELS[m.kind]} · {m.provenance === "MANUAL" ? "manuel" : "auto"}</span>
                  {m.advice && <p className="text-xs text-muted">{m.advice}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card">
          <h2 className="h2">Groupes</h2>
          {teams.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {teams.map((t) => <li key={t.id}><Link className="underline" href={`/app/teams/${t.id}`}>{t.name}</Link> <span className="text-xs text-muted">· {t._count.reports} partie(s) commune(s)</span></li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-muted">Aucun. <Link className="underline" href="/app/teams">Créer un groupe</Link>.</p>}
        </section>
        <section className="card lg:col-span-2">
          <h2 className="h2">Enregistrements et analyses</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <Link href="/app/capture">
              {devices.length === 0 ? (
                <Badge tone="neutral">Capture PC : aucun PC appairé</Badge>
              ) : recordingNow ? (
                <Badge tone="info">Capture PC : enregistrement en cours</Badge>
              ) : online.length ? (
                <Badge tone="ok">Capture PC : {online.length} PC en ligne</Badge>
              ) : (
                <Badge tone="warn">Capture PC : hors ligne</Badge>
              )}
            </Link>
            <Badge tone="info">Analyse assistée : expérimentale</Badge>
            {draftCount > 0 && (
              <Link href={`/app/videos/${drafts[0]!.recordingId}`}>
                <Badge tone="warn">{draftCount} proposition(s) automatique(s) à valider</Badge>
              </Link>
            )}
            <Badge tone="info">Traitements en attente/en cours : {jobCount("PENDING") + jobCount("RUNNING")}</Badge>
            {jobCount("FAILED") > 0 && <Badge tone="bad">Échecs : {jobCount("FAILED")}</Badge>}
          </div>
          {recordings.length > 0 && (
            <ul className="mt-3 divide-y divide-line text-sm">
              {recordings.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-1.5">
                  <Link className="hover:underline" href={`/app/videos/${r.id}`}>{r.title}</Link>
                  <Badge tone={RECORDING_STATUS[r.status]!.tone}>{RECORDING_STATUS[r.status]!.label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
