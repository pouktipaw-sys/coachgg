import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { InviteForm, TeamSettingsForm } from "@/components/teams/TeamForms";
import { GoalForm } from "@/components/GoalForm";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { MODE_LABELS, ROLE_LABELS, ScorePill, fmtDuration, fmtNum } from "@/components/stats";
import { requirePageUser } from "@/server/auth/page";
import { HttpError } from "@/server/errors";
import { teamDashboard, teamMatchDetail } from "@/server/teams/dashboard";
import { formatMs } from "@/lib/annotations/coaching";
import { KIND_LABELS } from "@/lib/annotations/schema";

export const metadata = { title: "Groupe" };

export default async function TeamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ match?: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const { match: matchId } = await searchParams;
  let data;
  try {
    data = await teamDashboard(user.id, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const { team, myRole, reports, stats, goals } = data;
  const selected = matchId ?? reports[0]?.matchId;
  const detail = selected ? await teamMatchDetail(user.id, id, selected) : null;
  const isAdmin = myRole === "ADMIN";

  return (
    <div className="space-y-6">
      <PageHeader
        title={team.name}
        subtitle={team.description ?? `${team.memberships.length} membre(s)`}
        actions={
          <>
            <Link href="/app/teams" className="btn-ghost">← Groupes</Link>
            <ActionButton url={`/api/teams/${id}/leave`} label="Quitter le groupe" className="btn-danger"
              confirmText="Quitter ce groupe ? Vos vidéos partagées avec lui ne le seront plus." redirectTo="/app/teams" />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card"><p className="text-xs uppercase text-muted">Parties communes</p><p className="text-3xl font-semibold">{stats.commonMatches}</p></div>
        <div className="card"><p className="text-xs uppercase text-muted">Victoires ensemble</p><p className="text-3xl font-semibold">{stats.wins}<span className="text-base text-muted">/{stats.commonMatches}</span></p></div>
        <div className="card">
          <p className="text-xs uppercase text-muted">MVP du groupe (nombre de parties)</p>
          {stats.mvpCount.length ? (
            <ul className="mt-1 text-sm">{stats.mvpCount.slice(0, 3).map((m) => <li key={m.name}>{m.name} — {m.n}</li>)}</ul>
          ) : <p className="mt-1 text-sm text-muted">Aucun pour l&apos;instant.</p>}
        </div>
      </div>

      {detail ? (
        <section className="card space-y-4" aria-label="Partie commune">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="h2">Partie du {new Date(reports.find((r) => r.matchId === selected)?.date ?? Date.now()).toLocaleString("fr-FR")}</h2>
            <Link className="text-sm underline" href={`/app/matches/${selected}`}>Rapport complet du match</Link>
          </div>
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm" data-testid="mvp-explanation">
            <p className="font-medium">🏆 MVP du groupe {detail.report.isTie ? "(égalité)" : ""}</p>
            <p className="mt-1">{detail.explanation.text}</p>
            <p className="mt-1 text-xs text-muted">MVP parmi les membres du groupe présents, pas parmi les 10 joueurs de la partie.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="py-2">Joueur</th><th>Rôle</th><th>Note</th><th>Distinction</th><th>Détail</th></tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {detail.rows.map((r) => (
                  <tr key={r.userId}>
                    <td className="py-2 font-medium">{r.name}{r.isMvp && <span className="ml-1" title="MVP du groupe">🏆</span>}<span className="block text-xs font-normal text-muted">{r.champion}</span></td>
                    <td className="py-2">{r.role ? ROLE_LABELS[r.role] : "—"}</td>
                    <td className="py-2"><ScorePill score={r.overall} reliability={r.reliability} /></td>
                    <td className="py-2">{r.distinctions.length ? r.distinctions.map((d) => <span key={d.key} className="mr-1 inline-block"><Badge tone="info" title={d.reason}>{d.label}</Badge></span>) : <span className="text-muted">—</span>}</td>
                    <td className="py-2">
                      <details>
                        <summary className="cursor-pointer text-xs text-accent-2">Voir</summary>
                        <div className="mt-2 space-y-2 text-xs">
                          {r.stats ? (
                            <p className="font-mono">K/D/A {r.stats.kills}/{r.stats.deaths}/{r.stats.assists} · CS {fmtNum(r.stats.creepScore)} · vision {fmtNum(r.stats.visionScore)} · dégâts {fmtNum(r.stats.damageToChampions)}</p>
                          ) : <p className="text-muted">Ce membre ne partage pas ses statistiques détaillées avec ses groupes.</p>}
                          {r.components.length > 0 && (
                            <p className="text-muted">{r.components.filter((c) => c.available).map((c) => `${c.key === "risk" ? "risque" : c.key} ${c.score}`).join(" · ")}</p>
                          )}
                          {r.positives.length > 0 && <p><strong>Points forts :</strong> {r.positives.map((p) => p.text).join(" ; ")}</p>}
                          {r.priority && <p><strong>Priorité :</strong> {r.priority}</p>}
                          <div>
                            <strong>Clips partagés :</strong>{" "}
                            {r.clips.length ? (
                              <ul className="ml-4 list-disc">
                                {r.clips.map((c) => <li key={c.id}><Link className="underline" href={`/app/videos/${c.recordingId}`}>{formatMs(c.decisionMs)} — {c.title}</Link></li>)}
                              </ul>
                            ) : <span className="text-muted">{r.hasVideo ? "aucun moment" : "aucune vidéo partagée par ce membre"}</span>}
                          </div>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.explanation.excluded.length > 0 && <p className="text-xs text-muted">Sans note comparable : {detail.explanation.excluded.length} membre(s) (données insuffisantes).</p>}

          <div className="rounded-lg border border-line p-4">
            <h3 className="font-medium">Rapport collectif</h3>
            {detail.collective ? (
              <ul className="mt-2 space-y-1.5 text-sm">
                <li><strong className="text-win">Une réussite :</strong> {detail.collective.success.text}</li>
                <li><strong className="text-warn">Un problème observable :</strong> {detail.collective.problem?.text ?? "aucune dimension commune sous 6/10."}</li>
                <li>
                  <strong>Une séquence à revoir :</strong>{" "}
                  {detail.collective.sequence ? (
                    <Link className="underline" href={`/app/videos/${detail.collective.sequence.recordingId}`}>
                      {formatMs(detail.collective.sequence.decisionMs)} — {detail.collective.sequence.title} ({KIND_LABELS[detail.collective.sequence.kind as keyof typeof KIND_LABELS]})
                    </Link>
                  ) : <span className="text-muted">aucune vidéo de cette partie partagée avec le groupe.</span>}
                </li>
                <li><strong>Un objectif collectif :</strong> {detail.collective.goal ?? "maintenir le niveau actuel."}</li>
              </ul>
            ) : <p className="mt-2 text-sm text-muted">Données insuffisantes pour un rapport collectif comparable.</p>}
            {detail.collective && <p className="mt-2 text-xs text-muted">{detail.collective.basis} Le visionnage synchronisé de plusieurs vidéos n&apos;est pas encore disponible.</p>}
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="h2">Parties communes</h2>
        {reports.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="Aucune partie commune détectée"
              text="Une partie est commune quand au moins deux membres y sont reliés : importez-la via Riot ou saisissez-la en indiquant le Riot ID de vos amis (déclaré dans leur profil)."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-2">Date</th><th>Mode</th><th>Durée</th><th>Résultat</th><th>Présents</th><th>MVP</th></tr></thead>
              <tbody className="divide-y divide-line">
                {reports.map((r) => (
                  <tr key={r.id} className={r.matchId === selected ? "bg-accent/5" : ""}>
                    <td className="py-2"><Link className="underline" href={`/app/teams/${id}?match=${r.matchId}`}>{new Date(r.date).toLocaleDateString("fr-FR")}</Link></td>
                    <td>{r.gameMode ? MODE_LABELS[r.gameMode] ?? r.gameMode : "—"}</td>
                    <td className="font-mono">{fmtDuration(r.durationSec)}</td>
                    <td>{r.win == null ? "—" : r.win ? <span className="text-win">Victoire</span> : <span className="text-loss">Défaite</span>}</td>
                    <td className="text-xs">{r.present.join(", ")}</td>
                    <td className="text-xs">{r.mvp.length ? `${r.mvp.join(" & ")}${r.isTie ? " (égalité)" : ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="h2">Membres ({team.memberships.length})</h2>
          <ul className="divide-y divide-line text-sm">
            {team.memberships.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {m.user.displayName} {m.role === "ADMIN" && <Badge>Admin</Badge>}
                  <span className="block text-xs text-muted">
                    {m.user.gameIdentities[0] ? `${m.user.gameIdentities[0].gameName}#${m.user.gameIdentities[0].tagLine} (déclaré)` : "Riot ID non renseigné"}
                  </span>
                </span>
                {isAdmin && m.userId !== user.id && (
                  <span className="flex gap-2">
                    <ActionButton url={`/api/teams/${id}/members/${m.userId}`} method="PATCH" body={{ role: m.role === "ADMIN" ? "MEMBER" : "ADMIN" }}
                      label={m.role === "ADMIN" ? "Retirer admin" : "Nommer admin"} className="btn-ghost px-2 py-1 text-xs" />
                    <ActionButton url={`/api/teams/${id}/members/${m.userId}`} method="DELETE" label="Retirer" className="btn-danger px-2 py-1 text-xs"
                      confirmText={`Retirer ${m.user.displayName} du groupe ?`} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <div className="space-y-2 border-t border-line pt-3">
              <h3 className="font-medium">Inviter un ami</h3>
              <InviteForm teamId={id} />
              {team.invitations.length > 0 && (
                <ul className="text-xs text-muted">
                  {team.invitations.map((i) => (
                    <li key={i.id} className="flex items-center gap-2">
                      En attente : {i.invitee.displayName}
                      <ActionButton url={`/api/invitations/${i.id}`} method="DELETE" label="Annuler" className="underline text-xs" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="h2">Objectifs collectifs</h2>
          {goals.length === 0 ? <p className="text-sm text-muted">Aucun objectif collectif.</p> : (
            <ul className="space-y-2 text-sm">
              {goals.map((g) => (
                <li key={g.id} className="rounded-lg bg-panel-2 p-3">
                  <p className="font-medium">{g.title} <Badge tone={g.status === "ACTIVE" ? "info" : g.status === "ACHIEVED" ? "ok" : "neutral"}>{g.status === "ACTIVE" ? "En cours" : g.status === "ACHIEVED" ? "Atteint" : "Abandonné"}</Badge></p>
                  {g.progress && <p className="text-xs text-muted">{g.progress.label} : {g.progress.met}/{g.progress.matches} performance(s) individuelle(s) sur la période</p>}
                </li>
              ))}
            </ul>
          )}
          <GoalForm teamId={id} />
          {isAdmin && (
            <details className="border-t border-line pt-3">
              <summary className="cursor-pointer text-sm">Paramètres du groupe</summary>
              <div className="mt-2 space-y-3">
                <TeamSettingsForm team={team} />
                <ActionButton url={`/api/teams/${id}`} method="DELETE" label="Supprimer le groupe" className="btn-danger" confirmText="Supprimer définitivement ce groupe ?" redirectTo="/app/teams" />
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
