import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { EmptyState, PageHeader, formatDate } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requirePageUser();
  const items = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Notifications" actions={unread > 0 ? <ActionButton url="/api/notifications" body={{}} label="Tout marquer comme lu" /> : undefined} />
      {items.length === 0 ? (
        <EmptyState title="Aucune notification" text="Vous serez prévenu quand une vidéo est prête ou quand on vous invite dans un groupe." />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className={`card py-3 ${n.readAt ? "opacity-70" : "border-accent/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{n.title}</p>
                  {n.body && <p className="text-sm text-muted">{n.body}</p>}
                  {n.link && <Link className="text-sm underline" href={n.link}>Ouvrir</Link>}
                </div>
                <span className="shrink-0 text-xs text-muted">{formatDate(n.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
