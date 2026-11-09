import Link from "next/link";
import { CreateTeamForm } from "@/components/teams/TeamForms";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";

export const metadata = { title: "Groupes" };

export default async function TeamsPage() {
  const user = await requirePageUser();
  const memberships = await prisma.teamMembership.findMany({
    where: { userId: user.id },
    include: { team: { include: { _count: { select: { memberships: true, reports: true } } } } },
    orderBy: { joinedAt: "desc" },
  });
  return (
    <div>
      <PageHeader title="CoachGG Team" subtitle="Comparez vos notes sur les parties jouées ensemble et progressez en groupe." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {memberships.length === 0 ? (
            <EmptyState title="Aucun groupe" text="Créez un groupe puis invitez vos amis par email (ceux qui n’ont pas encore de compte reçoivent un lien d’inscription)." />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {memberships.map((m) => (
                <li key={m.id}>
                  <Link href={`/app/teams/${m.teamId}`} className="card flex items-center gap-3 hover:border-accent/60">
                    {m.team.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.team.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-panel-2 text-lg font-semibold">{m.team.name.slice(0, 1).toUpperCase()}</div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.team.name}</p>
                      <p className="text-xs text-muted">{m.team._count.memberships} membre(s) · {m.team._count.reports} partie(s) commune(s)</p>
                    </div>
                    {m.role === "ADMIN" && <span className="ml-auto"><Badge>Admin</Badge></span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <CreateTeamForm />
      </div>
    </div>
  );
}
