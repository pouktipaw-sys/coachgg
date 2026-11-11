import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { ROLE_LABELS, Sparkline } from "@/components/stats";
import { requirePageUser } from "@/server/auth/page";
import { impactProfile, progressProfile, reviewSummary, weeklyReview } from "@/server/progress";
import { RadarChart } from "@/components/RadarChart";
import { IMPACT_LABELS, type ImpactKind } from "@/lib/impact";
import { CURRENT_SCORE_CONFIG } from "@/lib/scoring/config";

export const metadata = { title: "Progression" };

const SHORT: Record<string, string> = { resources: "Farm", participation: "Participation", damage: "Dégâts", risk: "Survie", vision: "Vision", objectives: "Objectifs" };

export default async function ProgressPage() {
  const user = await requirePageUser();
  const [p, week, impact] = await Promise.all([progressProfile(user.id), weeklyReview(user.id), impactProfile(user.id)]);
  if (p.total === 0)
    return (
      <div>
        <PageHeader title="Progression" />
        <EmptyState title="Pas encore de partie notée" text="Ajoutez des matchs pour suivre vos forces, vos difficultés et vos tendances." action={{ href: "/app/matches/new", label: "Ajouter un match" }} />
      </div>
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Progression"
        subtitle={`${p.total} partie(s) notée(s) · formule ${CURRENT_SCORE_CONFIG.version} (expérimentale) · comparaison à votre propre historique`}
        actions={<Link href="/app/coach" className="btn-ghost">Demander au coach</Link>}
      />

      <section className="card" data-testid="weekly-review">
        <h2 className="h2">Bilan des 7 derniers jours</h2>
        {week ? <p className="mt-2 text-sm">{reviewSummary(week)}.</p> : <p className="mt-2 text-sm text-muted">Aucune activité cette semaine.</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3" data-testid="impact">
          <h2 className="h2">Porteur ou porté ?</h2>
          <p className={`text-lg font-semibold ${impact.verdict.kind === "CARRY" ? "text-win" : impact.verdict.kind === "CARRIED" ? "text-warn" : ""}`} data-testid="impact-verdict">
            {impact.verdict.title}
          </p>
          <p className="text-sm">{impact.verdict.detail}</p>
          {impact.n > 0 && (
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {(Object.keys(IMPACT_LABELS) as ImpactKind[]).map((k) => (
                <li key={k} className="rounded-lg bg-panel-2 px-3 py-2">
                  <span className="font-mono text-lg">{impact.counts[k]}</span> <span className="text-xs text-muted">{IMPACT_LABELS[k]}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            Sur tes {impact.n} dernières parties où au moins 2 coéquipiers sont notés : ta note CoachGG comparée à leur moyenne (écart d&apos;1 point ou plus = différence nette).
            {impact.mvpVotes > 0 && ` Tes coéquipiers t'ont aussi donné ${impact.mvpVotes} vote(s) MVP.`}
          </p>
        </section>
        <section className="card">
          <h2 className="h2">Profil de joueur</h2>
          <RadarChart
            axes={p.trends.map((t) => ({ key: t.key, label: SHORT[t.key] ?? t.label, now: t.avg, before: t.previous }))}
          />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="h2">Historique des notes</h2>
          <div className="mt-3"><Sparkline values={p.history} height={90} /></div>
        </section>
        <section className="card space-y-3">
          <div>
            <h2 className="h2">Forces</h2>
            {p.strengths.length ? (
              <ul className="mt-1 text-sm">{p.strengths.map((s) => <li key={s.key} className="text-win">• <span className="text-text">{s.label} — {s.avg}/10</span></li>)}</ul>
            ) : <p className="text-sm text-muted">Aucune dimension durablement ≥ 7/10.</p>}
          </div>
          <div>
            <h2 className="h2">Difficultés</h2>
            {p.weaknesses.length ? (
              <ul className="mt-1 text-sm">{p.weaknesses.map((s) => <li key={s.key} className="text-warn">• <span className="text-text">{s.label} — {s.avg}/10</span></li>)}</ul>
            ) : <p className="text-sm text-muted">Aucune dimension durablement ≤ 5/10.</p>}
          </div>
        </section>
      </div>

      <section className="card overflow-x-auto">
        <h2 className="h2">Tendances par dimension</h2>
        <table className="mt-2 w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-1">Dimension</th><th>10 dernières</th><th>10 précédentes</th><th>Évolution</th><th>Parties</th></tr></thead>
          <tbody className="divide-y divide-line">
            {p.trends.map((t) => (
              <tr key={t.key}>
                <td className="py-1.5">{t.label}</td>
                <td className="font-mono">{t.avg}</td>
                <td className="font-mono">{t.previous ?? "—"}</td>
                <td className={t.delta == null ? "text-xs text-muted" : `font-mono ${t.delta >= 0.5 ? "text-win" : t.delta <= -0.5 ? "text-warn" : ""}`}>
                  {t.delta == null ? "historique insuffisant" : `${t.delta >= 0 ? "+" : ""}${t.delta}`}
                </td>
                <td>{t.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card overflow-x-auto">
          <h2 className="h2">Par rôle</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-1">Rôle</th><th>Parties</th><th>Note moy.</th><th>Victoires</th></tr></thead>
            <tbody className="divide-y divide-line">
              {p.byRole.map((r) => <tr key={r.key}><td className="py-1.5">{ROLE_LABELS[r.key] ?? "Inconnu"}</td><td>{r.n}</td><td className="font-mono">{r.avgScore}</td><td>{r.winrate} %</td></tr>)}
            </tbody>
          </table>
        </section>
        <section className="card overflow-x-auto">
          <h2 className="h2">Par champion</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-1">Champion</th><th>Parties</th><th>Note moy.</th><th>Victoires</th></tr></thead>
            <tbody className="divide-y divide-line">
              {p.byChampion.map((r) => <tr key={r.key}><td className="py-1.5">{r.key}</td><td>{r.n}</td><td className="font-mono">{r.avgScore}</td><td>{r.winrate} %</td></tr>)}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Sur peu de parties, ces moyennes varient beaucoup : interprétez-les avec prudence.</p>
        </section>
      </div>

      <section className="card">
        <h2 className="h2">Objectifs accomplis ({p.goalsAchieved.length})</h2>
        {p.goalsAchieved.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm">{p.goalsAchieved.map((g) => <li key={g.id}>{g.title}{g.review ? ` — ${g.review}` : ""}</li>)}</ul>
        ) : <p className="mt-2 text-sm text-muted">Aucun pour l&apos;instant. <Link className="underline" href="/app/goals">Voir mes objectifs</Link>.</p>}
        <p className="mt-2 text-xs text-muted">{p.momentsCount} moment(s) de coaching publiés sur vos vidéos.</p>
      </section>
    </div>
  );
}
