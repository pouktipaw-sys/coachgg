import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { Badge, PageHeader, formatDate } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { integrationStatus } from "@/lib/env";

export const metadata = { title: "Administration" };

// Administration minimale : santé des traitements et signalements.
// Aucun accès au contenu des vidéos privées depuis cette page.
export default async function AdminPage() {
  const user = await requirePageUser();
  if (user.role !== "ADMIN") notFound();
  const [users, recordings, byStatus, jobs, feedback] = await Promise.all([
    prisma.user.count(),
    prisma.recording.count(),
    prisma.analysisJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.analysisJob.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.analysisFeedback.findMany({
      where: { kind: { in: ["INCORRECT", "UNCLEAR"] }, resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { recommendation: { select: { title: true, provenance: true, analysisVersion: true } } },
    }),
  ]);
  const integ = integrationStatus();
  return (
    <div className="space-y-6">
      <PageHeader title="Administration" />
      <div className="grid gap-4 md:grid-cols-4">
        <div className="card"><p className="text-xs uppercase text-muted">Utilisateurs</p><p className="text-2xl font-semibold">{users}</p></div>
        <div className="card"><p className="text-xs uppercase text-muted">Vidéos</p><p className="text-2xl font-semibold">{recordings}</p></div>
        <div className="card md:col-span-2">
          <p className="text-xs uppercase text-muted">Tâches</p>
          <p className="text-sm">{byStatus.map((s) => `${s.status} ${s._count._all}`).join(" · ") || "—"}</p>
        </div>
      </div>
      <section className="card">
        <h2 className="h2">Intégrations</h2>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {Object.entries(integ).map(([k, v]) => <li key={k}><code>{k}</code> : <Badge tone={v === "configured" ? "ok" : "warn"}>{v}</Badge></li>)}
        </ul>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="h2">Dernières tâches</h2>
        <table className="mt-2 w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-muted"><tr><th>Type</th><th>Statut</th><th>Essais</th><th>Durée</th><th>Erreur</th><th>Créée</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="py-1.5">{j.type}</td>
                <td><Badge tone={j.status === "SUCCEEDED" ? "ok" : j.status === "FAILED" ? "bad" : "info"}>{j.status}</Badge></td>
                <td>{j.attempts}/{j.maxAttempts}</td>
                <td>{j.processingMs != null ? `${(j.processingMs / 1000).toFixed(1)} s` : "—"}</td>
                <td className="max-w-xs truncate text-xs text-muted" title={j.error ?? ""}>{j.error ?? ""}</td>
                <td className="text-xs">{formatDate(j.createdAt)}</td>
                <td>{j.status === "FAILED" && j.recordingId && <ActionButton url={`/api/admin/jobs/${j.id}/retry`} label="Relancer" className="text-xs underline" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2 className="h2">Signalements de diagnostics</h2>
        {feedback.length === 0 ? <p className="mt-2 text-sm text-muted">Aucun signalement ouvert.</p> : (
          <ul className="mt-2 space-y-2 text-sm">
            {feedback.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-panel-2 p-2">
                <span>
                  <Badge tone="warn">{f.kind}</Badge> {f.recommendation?.title} <span className="text-xs text-muted">({f.recommendation?.provenance}, {f.recommendation?.analysisVersion})</span>
                  {f.comment && <span className="block text-xs text-muted">« {f.comment} »</span>}
                </span>
                <ActionButton url={`/api/admin/feedback/${f.id}`} label="Marquer traité" className="text-xs underline" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
