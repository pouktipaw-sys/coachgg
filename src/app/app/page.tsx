import Link from "next/link";
import { Badge, EmptyState, PageHeader, RECORDING_STATUS, formatDate } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";

export const metadata = { title: "Tableau de bord" };

export default async function Dashboard() {
  const user = await requirePageUser();
  const [profile, recordings] = await Promise.all([
    prisma.playerProfile.findUnique({ where: { userId: user.id } }),
    prisma.recording.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" }, take: 4 }),
  ]);
  return (
    <div>
      <PageHeader title={`Bonjour ${user.displayName}`} />
      {!profile?.onboardingCompletedAt && (
        <div className="card mb-4 border-accent/40">
          <p className="font-medium">Terminez votre profil</p>
          <p className="text-sm text-muted">Rôle, champions, objectif et niveau d&apos;explication.</p>
          <Link href="/app/onboarding" className="btn-primary mt-3">Configurer</Link>
        </div>
      )}
      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="h2">Dernières vidéos</h2>
          <Link className="text-sm underline" href="/app/videos">Tout voir</Link>
        </div>
        {recordings.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Aucune vidéo" action={{ href: "/app/videos/upload", label: "Importer une vidéo" }} />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {recordings.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/app/videos/${r.id}`} className="hover:underline">{r.title}</Link>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {formatDate(r.createdAt)} <Badge tone={RECORDING_STATUS[r.status]!.tone}>{RECORDING_STATUS[r.status]!.label}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
