import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { Badge, PageHeader } from "@/components/ui";
import { ComponentBars, MinuteChart, MODE_LABELS, RELIABILITY, ROLE_LABELS, ScorePill, fmtDuration, fmtNum } from "@/components/stats";
import { requirePageUser } from "@/server/auth/page";
import { HttpError } from "@/server/errors";
import { getMatchReport } from "@/server/matches/service";
import { progressionFor } from "@/server/scores";
import { prisma } from "@/server/db";
import { visibleRecordingWhere } from "@/server/permissions";
import { statAdvice, type Level } from "@/lib/scoring/advice";
import { COMPONENT_LABELS, CURRENT_SCORE_CONFIG } from "@/lib/scoring/config";
import type { ComponentResult, Factor, ScoreResult } from "@/lib/scoring/engine";
import { formatMs } from "@/lib/annotations/coaching";
import { voteBoard } from "@/server/peerVotes";
import { PeerVotePanel, type VoteBoard } from "@/components/votes/PeerVotePanel";

export const metadata = { title: "Rapport de match" };

export default async function MatchReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  let match;
  try {
    match = await getMatchReport(user.id, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const me = match.participants.find((p) => p.userId === user.id) ?? null;
  const myTimeline = (me?.statistics?.timeline ?? null) as { gold: number[]; cs: number[]; purchases: { t: number; itemId: number }[] } | null;
  const score = me?.scores.find((s) => s.scoreVersionId === CURRENT_SCORE_CONFIG.version) ?? null;
  const [profile, progression, recordings, myTeams] = await Promise.all([
    prisma.playerProfile.findUnique({ where: { userId: user.id } }),
    me ? progressionFor(user.id, me.id) : null,
    prisma.recording.findMany({
      where: { matchId: id, ...visibleRecordingWhere(user.id) },
      include: { recommendations: { where: { status: { in: ["PUBLISHED", "DISPUTED"] } }, orderBy: { decisionMs: "asc" }, select: { id: true, title: true, kind: true, decisionMs: true, advice: true } }, owner: { select: { displayName: true } } },
    }),
    prisma.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true } }),
  ]);
  const [board, tracked] = await Promise.all([
    voteBoard(user.id, id),
    prisma.teammate.findMany({ where: { ownerId: user.id }, select: { gameName: true, tagLine: true } }),
  ]);
  const isTracked = (n: string | null, t: string | null) =>
    !!n && tracked.some((x) => x.gameName.toLowerCase() === n.toLowerCase() && x.tagLine.toLowerCase() === (t ?? "").toLowerCase());
  const myTeamIds = new Set(myTeams.map((t) => t.teamId));
  const teamReports = match.teamReports.filter((r) => myTeamIds.has(r.teamId));
  const components = (score?.components ?? []) as unknown as ComponentResult[];
  const missing = (score?.missingData ?? { items: [], reliabilityReasons: [] }) as { items: string[]; reliabilityReasons: string[] };
  const advice = score
    ? statAdvice({ components, overall: score.overall } as ScoreResult, (profile?.explanationLevel ?? "INTERMEDIATE") as Level)
    : [];
  const sides = [100, 200].map((s) => ({ side: s, players: match.participants.filter((p) => p.teamSide === s) })).filter((x) => x.players.length);

  return (
    <div className="space-y-6">
      <PageHeader
        title={me ? `${me.championName} — ${me.win ? "Victoire" : "Défaite"}` : "Rapport de match"}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {(match.gameStartAt ?? match.createdAt).toLocaleString("fr-FR")} · {fmtDuration(match.durationSec)} ·{" "}
            {match.gameMode ? MODE_LABELS[match.gameMode] ?? match.gameMode : "Mode inconnu"}
            {match.isDemo ? <Badge tone="warn">Démo</Badge> : <Badge>{match.source === "RIOT_API" ? "Importé via l'API Riot" : "Statistiques saisies manuellement"}</Badge>}
          </span>
        }
        actions={
          <>
            <Link href="/app/matches" className="btn-ghost">← Historique</Link>
            {match.createdById === user.id && (
              <ActionButton url={`/api/matches/${id}`} method="DELETE" label="Supprimer" className="btn-danger" confirmText="Supprimer ce match et ses notes ?" redirectTo="/app/matches" />
            )}
          </>
        }
      />

      {!me && <p className="card text-sm text-muted">Vous consultez ce match via un groupe : vous n&apos;y apparaissez pas.</p>}

      {me && (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* 1. Résumé + 4. Note expliquée */}
          <section className="card lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="h2">Résumé</h2>
                <p className="mt-1 text-sm text-muted">
                  {me.role ? ROLE_LABELS[me.role] : "Rôle inconnu"} · K/D/A {me.statistics?.kills}/{me.statistics?.deaths}/{me.statistics?.assists} ·{" "}
                  {fmtNum(me.statistics?.creepScore)} CS · {fmtNum(me.statistics?.goldEarned)} or · vision {fmtNum(me.statistics?.visionScore)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted">Note CoachGG</p>
                <p className="text-4xl font-semibold" data-testid="match-score">{score?.overall != null ? score.overall.toFixed(1) : "—"}<span className="text-base text-muted">/10</span></p>
                {score && <p className={`text-xs ${RELIABILITY[score.reliability]?.tone}`}>{RELIABILITY[score.reliability]?.label}</p>}
              </div>
            </div>
            {score ? (
              <>
                <div className="mt-5"><ComponentBars components={components} /></div>
                <div className="mt-4 rounded-lg bg-panel-2 p-3 text-xs text-muted">
                  <p><strong>Comment est calculée la note :</strong> moyenne pondérée selon le rôle des dimensions mesurables ci-dessus. Le résultat (victoire/défaite) n&apos;en fait pas partie.</p>
                  <ul className="mt-1 list-disc pl-4">{missing.reliabilityReasons?.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  {missing.items?.length > 0 && <p className="mt-1">Données manquantes : {missing.items.join(" · ")}</p>}
                  <p className="mt-1">
                    Formule {score.scoreVersionId}{score.scoreVersion.experimental ? " — expérimentale" : ""}. Repères internes v1 (heuristiques), non issus d&apos;un échantillon de joueurs.
                  </p>
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-muted">Note non calculée (statistiques absentes).</p>
            )}
          </section>

          <section className="card space-y-4">
            <div>
              <h2 className="h2">Progression personnelle</h2>
              {progression?.available ? (
                <p className="mt-1 text-sm">
                  <span className={progression.delta >= 0 ? "text-win" : "text-warn"}>{progression.delta >= 0 ? "+" : ""}{progression.delta}</span> par rapport à ta moyenne
                  ({progression.baseline}/10 sur {progression.sample} parties{progression.sameRole ? " au même rôle" : ""}).
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">{progression && !progression.available ? progression.reason : "—"}</p>
              )}
              <p className="mt-1 text-xs text-muted">Comparaison prioritaire à ton propre historique, séparée de la note du match.</p>
            </div>
            <div>
              <h3 className="font-medium">Points forts</h3>
              <FactorList items={(score?.positives ?? []) as unknown as Factor[]} empty="Aucune dimension ≥ 7/10." tone="text-win" />
            </div>
            <div>
              <h3 className="font-medium">Points à améliorer</h3>
              <FactorList items={(score?.negatives ?? []) as unknown as Factor[]} empty="Aucune dimension ≤ 4/10." tone="text-warn" />
            </div>
          </section>
        </div>
      )}

      {me && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* 5. Recommandations */}
          <section className="card">
            <h2 className="h2">Trois priorités</h2>
            {advice.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Aucune dimension sous 6/10 : pas de priorité statistique. Les moments vidéo restent la meilleure source de travail.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {advice.map((a, i) => (
                  <li key={a.key} className="rounded-lg border border-line p-3 text-sm">
                    <p className="font-medium">{i + 1}. {a.title}</p>
                    <p className="text-xs text-muted">{a.why}</p>
                    <p className="mt-1">{a.action}</p>
                    <p className="mt-1 text-xs text-accent-2">🎬 {a.videoCheck}</p>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 text-xs text-muted">Recommandations issues des statistiques : elles indiquent une tendance, pas le contexte précis des actions.</p>
          </section>

          {/* 6. Clips + 7. Objectif */}
          <section className="card space-y-4">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="h2">Vidéos et moments associés</h2>
                {recordings.filter((r) => r.gameStartOffsetMs != null && r.status === "READY").length >= 1 && (
                  <Link className="btn text-xs" href={`/app/matches/${id}/sync`} data-testid="open-sync">Visionnage synchronisé</Link>
                )}
              </div>
              {recordings.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  Aucune vidéo liée. <Link className="underline" href="/app/videos/upload">Importer la vidéo de cette partie</Link> ou associer une vidéo existante depuis son lecteur.
                </p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {recordings.map((r) => (
                    <li key={r.id}>
                      <Link className="font-medium underline" href={`/app/videos/${r.id}`}>{r.title}</Link>
                      {r.ownerId !== user.id && <span className="text-xs text-muted"> · partagée par {r.owner.displayName}</span>}
                      <ul className="ml-4 mt-1 list-disc text-xs text-muted">
                        {r.recommendations.map((m) => <li key={m.id}>{formatMs(m.decisionMs)} — {m.title}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h2 className="h2">Objectif pour la prochaine partie</h2>
              {advice[0] ? (
                <div className="mt-2 space-y-2 text-sm">
                  <p>{advice[0].title} — <span className="text-muted">{advice[0].action}</span></p>
                  <ActionButton
                    url="/api/goals"
                    label="Créer cet objectif (14 jours)"
                    done="Objectif créé."
                    body={{ title: advice[0].title, reason: advice[0].why, expectedBehavior: advice[0].action, metricKey: advice[0].key, metricTarget: 6, periodDays: 14 }}
                  />
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">Pas d&apos;objectif statistique suggéré. <Link className="underline" href="/app/goals">Définir un objectif</Link>.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {(board.me || board.results.some((r) => r.tally.voters > 0)) && <PeerVotePanel matchId={id} initial={JSON.parse(JSON.stringify(board)) as VoteBoard} />}

      {myTimeline && (
        <section className="card space-y-4" data-testid="match-timeline">
          <h2 className="h2">Évolution dans la partie</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <MinuteChart values={myTimeline.gold} label="Or cumulé" color="#fbbf24" />
            <MinuteChart values={myTimeline.cs} label="CS cumulés" color="#34d399" />
          </div>
          {myTimeline.purchases.length > 0 && (
            <div>
              <p className="label">Achats</p>
              <p className="text-xs text-muted">
                {myTimeline.purchases.slice(0, 40).map((p) => `${formatMs(p.t)} objet n°${p.itemId}`).join(" · ")}
              </p>
              <p className="mt-1 text-[11px] text-muted">Identifiants d&apos;objets Riot (les noms nécessitent les données statiques Data Dragon, non intégrées).</p>
            </div>
          )}
          <p className="text-xs text-muted">Source : timeline MATCH-V5 de l&apos;API Riot (une valeur par minute).</p>
        </section>
      )}

      {teamReports.length > 0 && (
        <section className="card">
          <h2 className="h2">Entre amis</h2>
          {teamReports.map((r) => {
            const ex = r.explanation as { text: string };
            return (
              <p key={r.id} className="mt-2 text-sm">
                <Link className="underline" href={`/app/teams/${r.team.id}?match=${id}`}>{r.team.name}</Link> — {ex.text}
              </p>
            );
          })}
        </section>
      )}

      <section className="card">
        <h2 className="h2">Statistiques des joueurs</h2>
        {sides.map(({ side, players }) => (
          <div key={side} className="mt-4 overflow-x-auto">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              Équipe {side === 100 ? "bleue" : "rouge"} — {players[0]!.win ? "victoire" : "défaite"}
            </p>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-1">Joueur</th><th>Champion</th><th>Rôle</th><th>K/D/A</th><th>CS</th><th>Or</th><th>Dégâts</th><th>Obj.</th><th>Vision</th><th>Note</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {players.map((p) => {
                  const s = p.statistics;
                  const sc = p.scores.find((x) => x.scoreVersionId === CURRENT_SCORE_CONFIG.version);
                  return (
                    <tr key={p.id} className={p.userId === user.id ? "bg-accent/5" : ""}>
                      <td className="py-1.5">
                        {p.riotGameName ? `${p.riotGameName}#${p.riotTagLine ?? ""}` : "—"}
                        {p.user && <span className="text-xs text-accent-2"> · {p.user.displayName}</span>}
                        {p.userId !== user.id && p.riotGameName && p.riotTagLine && !isTracked(p.riotGameName, p.riotTagLine) && (
                          <span className="ml-1 align-middle">
                            <ActionButton url="/api/teammates" body={{ riotId: `${p.riotGameName}#${p.riotTagLine}`, platform: match.platform ?? "EUW1" }} label="+ Suivre" done="Ajouté à vos coéquipiers." className="text-xs text-accent-2 underline" />
                          </span>
                        )}
                      </td>
                      <td>{p.championName}</td>
                      <td>{p.role ? ROLE_LABELS[p.role] : "—"}</td>
                      <td className="font-mono">{s ? `${s.kills}/${s.deaths}/${s.assists}` : "—"}</td>
                      <td className="font-mono">{fmtNum(s?.creepScore)}</td>
                      <td className="font-mono">{fmtNum(s?.goldEarned)}</td>
                      <td className="font-mono">{fmtNum(s?.damageToChampions)}</td>
                      <td className="font-mono">{fmtNum(s?.damageToObjectives)}</td>
                      <td className="font-mono">{fmtNum(s?.visionScore)}</td>
                      <td><ScorePill score={sc?.overall ?? null} reliability={sc?.reliability} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        <p className="mt-3 text-xs text-muted">
          Participation aux éliminations, parts de dégâts et d&apos;objectifs : {Object.keys(COMPONENT_LABELS).length} dimensions définies dans la formule {CURRENT_SCORE_CONFIG.version}.
          {match.source === "RIOT_API" ? "Source : API Riot (MATCH-V5)." : "Achats et évolution minute par minute : non disponibles pour un match saisi manuellement."}
        </p>
      </section>
    </div>
  );
}

function FactorList({ items, empty, tone }: { items: Factor[]; empty: string; tone: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="mt-1 space-y-1 text-sm">
      {items.map((f) => <li key={f.key} className={tone}>• <span className="text-text">{f.text}</span></li>)}
    </ul>
  );
}
