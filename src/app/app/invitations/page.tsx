import { ActionButton } from "@/components/ActionButton";
import { EmptyState, PageHeader, formatDate } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";

export const metadata = { title: "Invitations" };

export default async function InvitationsPage() {
  const user = await requirePageUser();
  const invites = await prisma.teamInvitation.findMany({
    where: { inviteeId: user.id, status: "PENDING", expiresAt: { gt: new Date() } },
    include: { team: { include: { _count: { select: { memberships: true } } } }, inviter: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Invitations" subtitle="Rejoindre un groupe ne partage pas vos vidéos : vous choisirez ce que vous partagez." />
      {invites.length === 0 ? (
        <EmptyState title="Aucune invitation en attente" />
      ) : (
        <ul className="space-y-3">
          {invites.map((i) => (
            <li key={i.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{i.team.name}</p>
                <p className="text-xs text-muted">
                  Invité par {i.inviter.displayName} · {i.team._count.memberships} membre(s) · expire le {formatDate(i.expiresAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <ActionButton url={`/api/invitations/${i.id}`} body={{ accept: true }} label="Accepter" className="btn-primary" redirectTo={`/app/teams/${i.teamId}`} />
                <ActionButton url={`/api/invitations/${i.id}`} body={{ accept: false }} label="Refuser" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
