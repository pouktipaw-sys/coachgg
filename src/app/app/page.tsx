import Link from "next/link";
import { Badge, EmptyState, ProgressBar, RECORDING_STATUS, SectionHeader, StatTile } from "@/components/ui";
import { Icon } from "@/components/icons";
import { HeroArt } from "@/components/HeroArt";
import { ROLE_LABELS, ScorePill, Sparkline, formatRank, type RankEntry } from "@/components/stats";
import { integrationStatus } from "@/lib/env";
import { requirePageUser } from "@/server/auth/page";
import { autoSyncIfDue } from "@/server/riot/import";
import { prisma } from "@/server/db";
import { accountParticipantWhere, listUserMatches, parseMatchFilters } from "@/server/matches/queries";
import { goalProgress } from "@/server/goals";
import { COMPONENT_LABELS, CURRENT_SCORE_CONFIG, type ComponentKey } from "@/lib/scoring/config";
import { formatMs } from "@/lib/annotations/coaching";
import { KIND_LABELS } from "@/lib/annotations/schema";

export const metadata = { title: "Tableau de bord" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  await autoSyncIfDue(user.id).catch(() => null);
  // Plusieurs comptes Riot : le tableau de bord suit le compte choisi (principal par défaut), ou tous réunis.
  const accounts = await prisma.gameIdentity.findMany({ where: { userId: user.id }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
  const allAccounts = sp.account === "all" && accounts.length > 1;
  const identity = allAccounts ? null : accounts.find((a) => a.id === sp.account) ?? accounts[0] ?? null;
  const accountFilter = accounts.length > 1 && identity ? accountParticipantWhere(identity) : {};
  const [profile, matches, recordings, moments, goal, teams, jobs, scores] = await Promise.all([
    prisma.playerProfile.findUnique({ where: { userId: user.id } }),
    listUserMatches(user.id, parseMatchFilters({ account: accounts.length > 1 && identity ? identity.id : undefined }), 20),
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
      where: { scoreVersionId: CURRENT_SCORE_CONFIG.version, overall: { not: null }, participant: { userId: user.id, ...accountFilter, match: { isDemo: false } } },
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

  // Indicateurs calculés UNIQUEMENT sur les parties réelles listées (jamais inventés).
  const real = matches.filter((m) => !m.isDemo);
  const wins = real.filter((m) => m.me.win).length;
  const winrate = real.length ? Math.round((wins / real.length) * 100) : null;
  const kdaList = real.filter((m) => m.me.kills != null && m.me.deaths != null && m.me.assists != null);
  const kda = kdaList.length ? kdaList.reduce((a, m) => a + (m.me.kills! + m.me.assists!) / Math.max(1, m.me.deaths!), 0) / kdaList.length : null;
  const csList = real.filter((m) => m.me.creepScore != null && m.durationSec > 0);
  const csMin = csList.length ? csList.reduce((a, m) => a + m.me.creepScore! / (m.durationSec / 60), 0) / csList.length : null;
  // Taux de victoire glissant (5 parties) dans l'ordre chronologique.
  const chrono = [...real].reverse();
  const winSeries = chrono.length >= 5
    ? chrono.slice(4).map((_, k) => {
        const w = chrono.slice(k, k + 5);
        return { label: new Date(w.at(-1)!.date).toLocaleDateString("fr-FR"), value: Math.round((w.filter((x) => x.me.win).length / 5) * 100) };
      })
    : [];
  const ranks = Array.isArray(identity?.rank) ? (identity!.rank as RankEntry[]) : [];
  const mainRank = ranks.find((r) => r.queue === "RANKED_SOLO_5x5") ?? ranks[0];

  return (
    <div className="space-y-6">
      {/* ───────── Hero ───────── */}
      <section className="card-glow relative overflow-hidden p-0">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-magenta/20 blur-3xl" />
        <div className="relative grid items-center gap-4 p-6 md:grid-cols-[1.4fr_1fr] md:p-8">
          <div>
            <p className="eyebrow">Ton coach League of Legends</p>
            <h1 className="mt-2 font-display text-3xl font-bold leading-tight md:text-4xl">
              Bonjour <span className="text-gradient">{user.displayName}</span>
            </h1>
            <p className="mt-2 text-sm text-muted">
              {allAccounts ? `${accounts.length} comptes Riot réunis` : identity ? `${identity.gameName}#${identity.tagLine} · ${identity.platform} (déclaré)` : <Link className="underline" href="/app/settings#identite">Associer un Riot ID</Link>}
              {profile?.primaryRole ? ` · ${ROLE_LABELS[profile.primaryRole]}` : ""}
              {allAccounts ? "" : " · "}
              {allAccounts ? null : ranks.length
                ? ranks.map(formatRank).join(" · ")
                : integrationStatus().riotApi === "configured"
                  ? "Rang : à récupérer dans Paramètres"
                  : "Rang : non disponible (clé API Riot non configurée)"}
            </p>
            <p className="mt-4 max-w-lg text-[15px] text-text/90">
              {lastMatch
                ? `Dernière partie : ${lastMatch.me.championName}, ${lastMatch.me.win ? "victoire" : "défaite"}. Importe la vidéo pour voir où elle s'est jouée.`
                : "Importe la vidéo d'une partie : ton coach repère tes morts, tes retours ratés et tes sbires perdus, puis t'explique quoi changer."}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/app/videos/upload" className="btn-primary px-5 py-2.5 text-[15px]">
                <Icon name="bolt" size={18} /> Analyser ma partie
              </Link>
              <Link href="/app/matches/new" className="btn-ghost">Ajouter un match</Link>
            </div>
          </div>
          <HeroArt className="anim-float mx-auto hidden w-full max-w-sm drop-shadow-[0_0_30px_rgb(146_46_255/0.35)] md:block" />
        </div>
      </section>

      {accounts.length > 1 && (
        <nav aria-label="Compte Riot affiché" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Compte affiché :</span>
          {accounts.map((a) => (
            <Link
              key={a.id}
              href={`/app?account=${a.id}`}
              aria-current={!allAccounts && identity?.id === a.id ? "page" : undefined}
              className={`rounded-full border px-3 py-1 transition-colors ${!allAccounts && identity?.id === a.id ? "border-accent bg-accent/20 text-white shadow-[0_0_14px_-4px_rgb(146_46_255/0.9)]" : "border-line text-muted hover:text-text"}`}
            >
              {a.gameName}#{a.tagLine}
            </Link>
          ))}
          <Link
            href="/app?account=all"
            aria-current={allAccounts ? "page" : undefined}
            className={`rounded-full border px-3 py-1 transition-colors ${allAccounts ? "border-accent bg-accent/20 text-white shadow-[0_0_14px_-4px_rgb(146_46_255/0.9)]" : "border-line text-muted hover:text-text"}`}
          >
            Tous les comptes
          </Link>
        </nav>
      )}

      {!profile?.onboardingCompletedAt && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-accent/40">
          <div>
            <p className="font-display font-semibold">Termine ton profil</p>
            <p className="text-sm text-muted">Rôle, champions, objectif et niveau d&apos;explication adaptent les conseils.</p>
          </div>
          <Link href="/app/onboarding" className="btn-primary">Configurer</Link>
        </div>
      )}

      {/* ───────── Indicateurs (parties réelles uniquement) ───────── */}
      <section aria-label="Indicateurs" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon="trophy" label="Victoires" value={winrate == null ? "—" : `${winrate} %`} tone={winrate == null ? "default" : winrate >= 50 ? "win" : "loss"} hint={real.length ? `${wins}V / ${real.length - wins}D sur ${real.length} partie(s)` : "Aucune partie"} />
        <StatTile icon="sword" label="KDA moyen" value={kda == null ? "—" : kda.toFixed(2).replace(".", ",")} tone="accent" hint={kdaList.length ? `${kdaList.length} partie(s)` : "Statistiques manquantes"} />
        <StatTile icon="coin" label="Sbires / min" value={csMin == null ? "—" : csMin.toFixed(1).replace(".", ",")} hint={csList.length ? `${csList.length} partie(s)` : "Statistiques manquantes"} />
        <StatTile icon="flame" label="Note récente" value={lastMatch?.me.score == null ? "—" : lastMatch.me.score.toFixed(1).replace(".", ",")} tone="accent" hint={`formule ${CURRENT_SCORE_CONFIG.version}, expérimentale`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Évolution */}
        <section className="card lg:col-span-2">
          <SectionHeader icon="progress" title="Ta forme" sub="Note par partie et victoires sur 5 parties glissantes (valeurs réelles)" action={lastMatch ? <Link className="text-sm text-accent-2 hover:underline" href={`/app/matches/${lastMatch.id}`}>Dernière partie →</Link> : undefined} />
          {lastMatch ? (
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs text-muted">Note CoachGG</p>
                <Sparkline values={series.map((s) => ({ label: s.date.toLocaleDateString("fr-FR"), value: s.value }))} />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted">Taux de victoire (5 dernières parties)</p>
                {winSeries.length >= 2 ? <Sparkline values={winSeries} max={100} unit=" %" /> : <p className="text-sm text-muted">Au moins 6 parties sont nécessaires pour cette courbe.</p>}
              </div>
            </div>
          ) : (
            <EmptyState icon="stats" title="Aucune partie" text="Connecte ton compte Riot ou ajoute une partie pour suivre ta forme." action={{ href: "/app/matches/new", label: "Ajouter un match" }} />
          )}
        </section>

        {/* Rang et objectif */}
        <section className="card flex flex-col gap-4">
          <div>
            <SectionHeader icon="rank" title="Rang" action={<Link className="text-sm text-accent-2 hover:underline" href="/app/skills">Rang suivant →</Link>} />
            {mainRank ? (
              <div>
                <p className="font-display text-2xl font-bold">{formatRank(mainRank).split(" : ")[1]?.split(" · ")[0]}</p>
                <p className="text-xs text-muted">{mainRank.label} · {mainRank.lp} PL · {mainRank.wins}V/{mainRank.losses}D</p>
                <div className="mt-2"><ProgressBar value={Math.min(100, mainRank.lp)} label="Points de ligue vers la division suivante" /></div>
                <p className="mt-1 text-[11px] text-muted">{mainRank.lp}/100 PL vers la division suivante</p>
              </div>
            ) : (
              <p className="text-sm text-muted">Rang inconnu : associe ton Riot ID et une clé API Riot pour le récupérer.</p>
            )}
          </div>
          <div className="border-t border-line/70 pt-4">
            <SectionHeader icon="goal" title="Objectif actif" />
            {goal ? (
              <div className="text-sm">
                <p className="font-medium">{goal.title}</p>
                {goalProg && (
                  <>
                    <p className="mt-1 text-xs text-muted">{goalProg.label} : {goalProg.met}/{goalProg.matches} partie(s)</p>
                    {goalProg.matches > 0 && <div className="mt-2"><ProgressBar tone="win" value={(goalProg.met / goalProg.matches) * 100} label="Parties où l'objectif est atteint" /></div>}
                  </>
                )}
                <Link className="mt-2 inline-block text-xs text-accent-2 hover:underline" href="/app/goals">Gérer mes objectifs</Link>
              </div>
            ) : (
              <p className="text-sm text-muted">Aucun. <Link className="text-accent-2 hover:underline" href="/app/goals">Définir un objectif</Link>.</p>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Priorités */}
        <section className="card">
          <SectionHeader icon="target" title="Trois priorités" sub="Tes points les plus faibles sur 10 parties notées" />
          {priorities.length ? (
            <ol className="space-y-3">
              {priorities.map((p, i) => (
                <li key={p.key}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span><span className="mr-1.5 font-display font-bold text-accent-2">{i + 1}.</span>{COMPONENT_LABELS[p.key]}</span>
                    <span className="font-display text-xs tabular-nums text-warn">{String(p.avg).replace(".", ",")}/10</span>
                  </div>
                  <div className="mt-1"><ProgressBar tone="warn" value={p.avg * 10} label={`${COMPONENT_LABELS[p.key]} : ${p.avg} sur 10`} /></div>
                  <p className="mt-0.5 text-[11px] text-muted">moyenne sur {p.n} parties</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">{series.length < 2 ? "Au moins deux parties notées sont nécessaires." : "Aucune dimension durablement sous 6/10."}</p>
          )}
        </section>

        {/* Dernières parties */}
        <section className="card lg:col-span-2">
          <SectionHeader icon="stats" title="Dernières parties" action={<Link className="text-sm text-accent-2 hover:underline" href={identity && accounts.length > 1 ? `/app/matches?account=${identity.id}` : "/app/matches"}>Historique</Link>} />
          {matches.length === 0 ? <EmptyState title="Aucune partie" /> : (
            <ul className="space-y-1.5 text-sm">
              {matches.slice(0, 5).map((m) => (
                <li key={m.id}>
                  <Link href={`/app/matches/${m.id}`} className={`group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 transition-colors hover:border-line hover:bg-white/[0.03] ${m.me.win ? "bg-win/[0.04]" : "bg-loss/[0.04]"}`}>
                    <span aria-hidden className={`h-8 w-1 rounded-full ${m.me.win ? "bg-win shadow-[0_0_10px_rgb(52_211_153/0.7)]" : "bg-loss shadow-[0_0_10px_rgb(248_113_113/0.6)]"}`} />
                    <span className={`w-6 font-display font-bold ${m.me.win ? "text-win" : "text-loss"}`}>{m.me.win ? "V" : "D"}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{m.me.championName}</span> · <span className="tabular-nums">{m.me.kills}/{m.me.deaths}/{m.me.assists}</span>
                      {allAccounts && m.me.riotId && <span className="text-xs text-muted"> · {m.me.riotId}</span>}
                      {m.friends.length > 0 && <span className="text-xs text-muted"> · avec {m.friends.join(", ")}</span>}
                    </span>
                    <ScorePill score={m.me.score} reliability={m.me.reliability} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Moments de coaching */}
        <section className="card lg:col-span-2">
          <SectionHeader icon="coach" title="Derniers moments de coaching" action={<Link className="text-sm text-accent-2 hover:underline" href="/app/videos">Vidéos</Link>} />
          {moments.length === 0 ? (
            <p className="text-sm text-muted">Aucun moment. Ouvre une vidéo prête et ajoute un moment.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {moments.map((m) => (
                <li key={m.id}>
                  <Link className="card-hover block rounded-xl border border-line/70 bg-bg/40 p-3" href={`/app/videos/${m.recordingId}`}>
                    <p className="text-[11px] text-muted"><span className="font-display text-accent-2">{formatMs(m.decisionMs)}</span> · {KIND_LABELS[m.kind]} · {m.provenance === "MANUAL" ? "manuel" : "auto"}</p>
                    <p className="mt-0.5 text-sm font-medium">{m.title}</p>
                    {m.advice && <p className="mt-1 line-clamp-2 text-xs text-muted">{m.advice}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Raccourcis */}
        <section className="card">
          <SectionHeader icon="bolt" title="Raccourcis" />
          <div className="grid grid-cols-2 gap-2">
            {([
              ["/app/videos", "studio", "Mes vidéos"],
              ["/app/progress", "progress", "Progression"],
              ["/app/coach", "coach", "Coach IA"],
              ["/app/community", "community", "Communauté"],
              ["/app/friends", "friends", "Amis"],
              ["/app/clips", "clip", "Clips"],
            ] as const).map(([href, icon, label]) => (
              <Link key={href} href={href} className="card-hover flex flex-col items-center gap-1.5 rounded-xl border border-line/70 bg-bg/40 p-3 text-center text-xs">
                <Icon name={icon} size={20} className="text-accent-2" />
                {label}
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card">
          <SectionHeader icon="teams" title="Groupes" />
          {teams.length ? (
            <ul className="space-y-1 text-sm">
              {teams.map((t) => <li key={t.id}><Link className="text-accent-2 hover:underline" href={`/app/teams/${t.id}`}>{t.name}</Link> <span className="text-xs text-muted">· {t._count.reports} partie(s) commune(s)</span></li>)}
            </ul>
          ) : <p className="text-sm text-muted">Aucun. <Link className="text-accent-2 hover:underline" href="/app/teams">Créer un groupe</Link>.</p>}
        </section>
        <section className="card lg:col-span-2">
          <SectionHeader icon="capture" title="Enregistrements et analyses" />
          <div className="flex flex-wrap gap-2 text-sm">
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
            <ul className="mt-3 divide-y divide-line/70 text-sm">
              {recordings.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-1.5">
                  <Link className="hover:text-accent-2" href={`/app/videos/${r.id}`}>{r.title}</Link>
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
