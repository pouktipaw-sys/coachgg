import { AppNav } from "@/components/AppNav";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [unread, invites] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.teamInvitation.count({ where: { inviteeId: user.id, status: "PENDING", expiresAt: { gt: new Date() } } }),
  ]);
  return (
    <div className="lg:flex">
      <AppNav user={user} unread={unread} invites={invites} isAdmin={user.role === "ADMIN"} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
