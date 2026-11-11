import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { PageHeader } from "@/components/ui";
import { AddFriendForm, RequestButtons } from "@/components/friends/FriendActions";
import { Avatar, BadgeList, FormDots, RankChip, StreakTag } from "@/components/friends/FriendBits";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { friendsLeaderboard, listFriends, pendingFriendRequests, type LeaderboardMetric } from "@/server/friends";
import { listTeammates } from "@/server/teammates";
import { AWARD_LABEL, type AwardKey } from "@/lib/votes";

export const metadata = { title: "Amis" };

const METRICS: { key: LeaderboardMetric; label: string }[] = [
  { key: "score", label: "Note moyenne" },
  { key: "wins", label: "Victoires" },
  { key: "mvp", label: "Votes MVP" },
];
const MEDAL = ["🥇", "🥈", "🥉"];
const weekLine = (w: { games: number; wins: number }) => (w.games ? `${w.games} partie(s) · ${Math.round((w.wins / w.games) * 100)} % V` : "aucune partie");

export default async function FriendsPage({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const by = (METRICS.find((m) => m.key === sp.by)?.key ?? "score") as LeaderboardMetric;
  const [friends, requests, board, tracked, identity] = await Promise.all([
    listFriends(user.id),
    pendingFriendRequests(user.id),
    friendsLeaderboard(user.id, by),
    listTeammates(user.id),
    prisma.gameIdentity.findFirst({ where: { userId: user.id, isPrimary: true }, select: { platform: true } }),
  ]);
  const friendRiotIds = new Set(friends.map((f) => f.riotId?.toLowerCase()).filter(Boolean));
  const mateByRiotId = new Map(tracked.map((t) => [t.riotId.toLowerCase(), t]));
  const others = tracked.filter((t) => !friendRiotIds.has(t.riotId.toLowerCase()));
  const fmt = (c: (typeof board)[number]) =>
    by === "wins" ? `${c.value} V` : by === "mvp" ? `${c.value} 🏆` : c.value >= 0 ? `${c.value.toFixed(1)}/10` : "—";

  return (
    <div className="space-y-6">
      <PageHeader title="Ta squad" subtitle="Ajoute tes potes avec leur Riot ID, compare vos formes, et grimpe dans le classement de la semaine." />

      <section className="card space-y-2">
        <AddFriendForm defaultPlatform={identity?.platform ?? "EUW1"} />
        <p className="text-xs text-muted">
          S&apos;il a un compte CoachGG, il reçoit une demande d&apos;ami. Sinon, il est quand même suivi : vos parties ensemble et ses notes de coéquipier apparaissent ici.
        </p>
      </section>

      {requests.length > 0 && (
        <section className="card space-y-3" data-testid="friend-requests">
          <h2 className="h2">Demandes d&apos;ami ({requests.length})</h2>
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                <Avatar name={r.requester.displayName} size={36} />
                <span>
                  <strong>{r.requester.displayName}</strong>
                  {r.requester.gameIdentities[0] && <span className="text-xs text-muted"> · {r.requester.gameIdentities[0].gameName}#{r.requester.gameIdentities[0].tagLine}</span>}
                </span>
              </span>
              <RequestButtons id={r.id} />
            </div>
          ))}
          <p className="text-xs text-muted">Accepter partage avec cet ami votre rang, vos 5 dernières parties, vos badges et votre place au classement. Jamais vos vidéos.</p>
        </section>
      )}

      <section className="card space-y-4" data-testid="leaderboard">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">🏁 Classement de la semaine</h2>
          <nav className="flex gap-1 text-xs" aria-label="Critère du classement">
            {METRICS.map((m) => (
              <Link key={m.key} href={`/app/friends?by=${m.key}`} className={`rounded-full border px-3 py-1 ${m.key === by ? "border-accent bg-accent/20" : "border-line text-muted"}`}>{m.label}</Link>
            ))}
          </nav>
        </div>
        {board.length < 2 ? (
          <p className="text-sm text-muted">Ajoute au moins un ami pour lancer la compétition 😉</p>
        ) : (
          <>
            <div className="grid grid-cols-3 items-end gap-3 text-center">
              {[1, 0, 2].map((i) => {
                const c = board[i];
                if (!c) return <div key={i} />;
                return (
                  <div key={c.userId} className={`rounded-xl border p-3 ${i === 0 ? "border-warn/60 bg-warn/5 pb-6" : "border-line"} ${c.me ? "ring-1 ring-accent" : ""}`}>
                    <div className="text-3xl">{MEDAL[i]}</div>
                    <div className="mt-1 flex justify-center"><Avatar name={c.displayName} size={i === 0 ? 56 : 44} /></div>
                    <p className="mt-1 truncate font-medium">{c.displayName}{c.me ? " (toi)" : ""}</p>
                    <p className="font-mono text-lg">{fmt(c)}</p>
                    <p className="text-xs text-muted">{weekLine(c.week)}</p>
                  </div>
                );
              })}
            </div>
            {board.length > 3 && (
              <ol start={4} className="space-y-1 text-sm">
                {board.slice(3).map((c, i) => (
                  <li key={c.userId} className={`flex items-center justify-between rounded px-2 py-1 ${c.me ? "bg-accent/10" : ""}`}>
                    <span>{i + 4}. {c.displayName}{c.me ? " (toi)" : ""}</span>
                    <span><span className="mr-3 text-xs text-muted">{weekLine(c.week)}</span><span className="font-mono">{fmt(c)}</span></span>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-xs text-muted">
              7 derniers jours. {by === "score" ? "Note CoachGG moyenne, 3 parties minimum pour être classé." : by === "mvp" ? "Votes MVP reçus de ses coéquipiers (toutes parties)." : "Nombre de victoires."}
            </p>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="h2">Mes amis ({friends.length})</h2>
        {friends.length === 0 ? (
          <p className="card text-sm text-muted">Pas encore d&apos;amis sur CoachGG. Envoie une demande avec leur Riot ID ci-dessus !</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {friends.map((f) => {
              const mate = f.riotId ? mateByRiotId.get(f.riotId.toLowerCase()) : undefined;
              return (
                <li key={f.userId} className="card space-y-3" data-testid="friend-card">
                  <div className="flex items-start gap-3">
                    <Avatar name={f.displayName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{f.displayName}</p>
                      <p className="truncate text-xs text-muted">{f.riotId ?? "Riot ID non renseigné"}</p>
                    </div>
                    <RankChip rank={f.rank} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <FormDots form={f.form} />
                    <StreakTag streak={f.streak} />
                  </div>
                  <BadgeList badges={f.badges} />
                  <p className="text-xs text-muted">
                    Cette semaine : {f.week.games} partie(s){f.week.games ? `, ${f.week.wins} V` : ""}{f.week.avgScore != null ? ` · note ${f.week.avgScore}/10` : ""}
                    {mate && mate.games > 0 && (
                      <> · <Link className="underline" href={`/app/matches?mate=${mate.id}`}>duo : {mate.games} partie(s), {Math.round((mate.wins / mate.games) * 100)} % V</Link></>
                    )}
                  </p>
                  <div className="text-right">
                    <ActionButton url={`/api/friends/${f.friendshipId}`} method="DELETE" label="Retirer" className="text-xs text-muted underline" confirmText={`Retirer ${f.displayName} de vos amis ?`} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="suivis" className="space-y-3">
        <h2 className="h2">Joueurs suivis ({others.length})</h2>
        <p className="text-xs text-muted">Joueurs ajoutés par Riot ID sans compte CoachGG (ou pas encore amis) : parties ensemble et notes reçues en tant que coéquipier.</p>
        {others.length > 0 && (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="teammates">
            {others.map((m) => (
              <li key={m.id} className="card space-y-2 text-sm" data-testid="teammate-card">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Avatar name={m.nickname ?? m.riotId} size={32} />
                    <span>
                      <span className="font-medium">{m.nickname ?? m.riotId}</span>
                      <span className="block text-xs text-muted">{m.nickname ? `${m.riotId} · ` : ""}{m.platform}</span>
                    </span>
                  </span>
                  <ActionButton url={`/api/teammates/${m.id}`} method="DELETE" label="Retirer" className="text-xs text-muted underline" confirmText={`Ne plus suivre ${m.riotId} ?`} />
                </div>
                {m.games === 0 ? (
                  <p className="text-muted">Aucune partie commune pour l&apos;instant.</p>
                ) : (
                  <>
                    <p>
                      <Link className="underline" href={`/app/matches?mate=${m.id}`}>{m.games} partie(s) ensemble</Link> ·{" "}
                      <span className={m.wins / m.games >= 0.5 ? "text-win" : "text-loss"}>{Math.round((m.wins / m.games) * 100)} % de victoires</span>
                    </p>
                    <p className="text-muted">
                      Note reçue : {m.avgScore != null ? <span className="font-mono text-text">{m.avgScore}/10</span> : "—"}
                      {m.myAvgScore != null && <> · tes notes : <span className="font-mono text-text">{m.myAvgScore}/10</span></>}
                      {m.mvpVotes > 0 && <> · 🏆 {m.mvpVotes}</>}
                    </p>
                    {Object.keys(m.awards).length > 0 && (
                      <ul className="flex flex-wrap gap-1 text-xs">
                        {Object.entries(m.awards).map(([k, n]) => <li key={k} className="badge">{AWARD_LABEL[k as AwardKey] ?? k} ×{n}</li>)}
                      </ul>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
