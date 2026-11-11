import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { EmptyState, PageHeader } from "@/components/ui";
import { AddTeammateForm } from "@/components/teammates/AddTeammateForm";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { listTeammates } from "@/server/teammates";
import { AWARD_LABEL, type AwardKey } from "@/lib/votes";

export const metadata = { title: "Coéquipiers" };

export default async function TeammatesPage() {
  const user = await requirePageUser();
  const [mates, identity] = await Promise.all([
    listTeammates(user.id),
    prisma.gameIdentity.findFirst({ where: { userId: user.id, isPrimary: true }, select: { platform: true } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Coéquipiers"
        subtitle="Les joueurs avec qui vous jouez souvent, ajoutés par Riot ID (un compte CoachGG n'est pas nécessaire). Après chaque partie, notez-les et élisez le MVP depuis le rapport de match."
      />
      <section className="card">
        <AddTeammateForm defaultPlatform={identity?.platform ?? "EUW1"} />
        <p className="mt-2 text-xs text-muted">Astuce : dans un rapport de match, « + Suivre » ajoute un joueur en un clic.</p>
      </section>
      {mates.length === 0 ? (
        <EmptyState title="Aucun coéquipier" text="Ajoutez le Riot ID d'un ami pour retrouver vos parties ensemble, votre taux de victoire commun et les notes qu'il reçoit." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="teammates">
          {mates.map((m) => (
            <li key={m.id} className="card space-y-2 text-sm" data-testid="teammate-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{m.nickname ?? m.riotId}</p>
                  <p className="text-xs text-muted">{m.nickname ? `${m.riotId} · ` : ""}{m.platform}</p>
                </div>
                <ActionButton url={`/api/teammates/${m.id}`} method="DELETE" label="Retirer" className="text-xs text-muted underline" confirmText={`Retirer ${m.riotId} de vos coéquipiers ?`} />
              </div>
              {m.games === 0 ? (
                <p className="text-muted">Aucune partie commune dans votre historique pour l&apos;instant.</p>
              ) : (
                <>
                  <p>
                    <Link className="underline" href={`/app/matches?mate=${m.id}`}>{m.games} partie(s) ensemble</Link> ·{" "}
                    <span className={m.wins / m.games >= 0.5 ? "text-win" : "text-loss"}>{Math.round((m.wins / m.games) * 100)} % de victoires</span> ({m.wins}V/{m.games - m.wins}D)
                  </p>
                  <p className="text-muted">
                    Note moyenne reçue : {m.avgScore != null ? <span className="font-mono text-text">{m.avgScore}/10</span> : "—"}
                    {m.myAvgScore != null && <> · vos notes : <span className="font-mono text-text">{m.myAvgScore}/10</span></>}
                    {m.mvpVotes > 0 && <> · 🏆 {m.mvpVotes} vote(s) MVP</>}
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
    </div>
  );
}
