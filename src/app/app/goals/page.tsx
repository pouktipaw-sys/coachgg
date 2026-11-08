import { ActionButton } from "@/components/ActionButton";
import { GoalForm } from "@/components/GoalForm";
import { Badge, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { goalProgress } from "@/server/goals";

export const metadata = { title: "Objectifs" };

const STATUS = { ACTIVE: ["En cours", "info"], ACHIEVED: ["Atteint", "ok"], ABANDONED: ["Abandonné", "neutral"], EXPIRED: ["Expiré", "neutral"] } as const;

export default async function GoalsPage() {
  const user = await requirePageUser();
  const goals = await prisma.goal.findMany({ where: { ownerId: user.id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  const withProgress = await Promise.all(goals.map(async (g) => ({ ...g, progress: await goalProgress(g) })));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Objectifs" subtitle="Un comportement précis, mesuré sur vos parties réelles. Aucun rang n'est promis." />
      <GoalForm />
      {withProgress.length === 0 ? (
        <EmptyState title="Aucun objectif" text="Créez-en un, ou depuis un rapport de match à partir de vos priorités." />
      ) : (
        <ul className="space-y-3">
          {withProgress.map((g) => {
            const expired = g.status === "ACTIVE" && g.periodEnd && g.periodEnd < new Date();
            const [label, tone] = STATUS[expired ? "EXPIRED" : g.status];
            return (
              <li key={g.id} className="card space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{g.title} <Badge tone={tone}>{label}</Badge></p>
                  <span className="text-xs text-muted">{formatDate(g.periodStart)} → {g.periodEnd ? formatDate(g.periodEnd) : "—"}</span>
                </div>
                {g.reason && <p className="text-sm text-muted">Pourquoi : {g.reason}</p>}
                {g.expectedBehavior && <p className="text-sm">Comportement attendu : {g.expectedBehavior}</p>}
                {g.progress ? (
                  <p className="text-sm">
                    Bilan : <strong>{g.progress.met}/{g.progress.matches}</strong> partie(s) avec {g.progress.label}
                    {g.progress.matches === 0 && <span className="text-muted"> — aucune partie notée sur la période pour l&apos;instant.</span>}
                  </p>
                ) : <p className="text-xs text-muted">Sans indicateur chiffré : bilan à faire vous-même.</p>}
                {g.status === "ACTIVE" && (
                  <div className="flex gap-2">
                    <ActionButton url={`/api/goals/${g.id}`} method="PATCH" body={{ status: "ACHIEVED" }} label="Marquer atteint" />
                    <ActionButton url={`/api/goals/${g.id}`} method="PATCH" body={{ status: "ABANDONED" }} label="Abandonner" />
                  </div>
                )}
                <ActionButton url={`/api/goals/${g.id}`} method="DELETE" label="Supprimer" className="text-xs text-muted underline" confirmText="Supprimer cet objectif ?" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
