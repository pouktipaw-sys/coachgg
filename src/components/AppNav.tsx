"use client";
// Navigation : barre latérale par catégories (ordinateur) ; barre du bas + tiroir « Plus » (mobile).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";
import { Logo } from "./Logo";

type Item = { href: string; label: string; icon: IconName; badge?: number };
type Group = { title: string; items: Item[] };

export function AppNav({ user, unread, invites, friendRequests = 0, isAdmin }: { user: { displayName: string }; unread: number; invites: number; friendRequests?: number; isAdmin: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const groups: Group[] = [
    {
      title: "Analyser",
      items: [
        { href: "/app", label: "Tableau de bord", icon: "home" },
        { href: "/app/videos", label: "Vidéos & coaching", icon: "studio" },
        { href: "/app/clips", label: "Clips", icon: "clip" },
        { href: "/app/capture", label: "Capture PC", icon: "capture" },
      ],
    },
    {
      title: "Performance",
      items: [
        { href: "/app/matches", label: "Matchs & stats", icon: "stats" },
        { href: "/app/progress", label: "Progression", icon: "progress" },
        { href: "/app/skills", label: "Rang suivant", icon: "rank" },
        { href: "/app/goals", label: "Objectifs", icon: "goal" },
        { href: "/app/coach", label: "Coach", icon: "coach" },
      ],
    },
    {
      title: "Social",
      items: [
        { href: "/app/community", label: "Communauté", icon: "community" },
        { href: "/app/friends", label: "Amis", icon: "friends", badge: friendRequests },
        { href: "/app/teams", label: "Groupes", icon: "teams" },
        { href: "/app/invitations", label: "Invitations", icon: "mail", badge: invites },
      ],
    },
    {
      title: "Compte",
      items: [
        { href: "/app/notifications", label: "Notifications", icon: "bell", badge: unread },
        { href: "/app/settings", label: "Paramètres", icon: "settings" },
        { href: "/app/support", label: "Aide", icon: "help" },
        ...(isAdmin ? [{ href: "/app/admin", label: "Administration", icon: "admin" as const }] : []),
      ],
    },
  ];
  const active = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));
  const alerts = unread + invites + friendRequests;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-5 px-3" aria-label="Navigation principale">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted/60">{g.title}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const on = active(it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={on ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all ${
                    on ? "bg-gradient-to-r from-accent/25 to-magenta/5 text-white" : "text-muted hover:bg-white/[0.04] hover:text-text"
                  }`}
                >
                  {on && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-gradient-to-b from-accent to-magenta shadow-[0_0_12px_rgb(211_74_255/0.9)]" />}
                  <Icon name={it.icon} className={on ? "text-accent-2" : "text-muted/80 group-hover:text-accent-2"} />
                  <span className="flex-1">{it.label}</span>
                  {!!it.badge && <span className="rounded-full bg-magenta px-1.5 text-[11px] font-bold text-white shadow-[0_0_10px_rgb(211_74_255/0.7)]">{it.badge}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const userBox = (
    <div className="border-t border-line/70 px-4 py-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-magenta font-display text-sm font-bold text-white">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.displayName}</p>
          <button onClick={logout} className="flex items-center gap-1 text-xs text-muted hover:text-text">
            <Icon name="logout" size={13} /> Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );

  const bottom: Item[] = [
    { href: "/app", label: "Accueil", icon: "home" },
    { href: "/app/videos", label: "Vidéos", icon: "studio" },
    { href: "/app/matches", label: "Stats", icon: "stats" },
    { href: "/app/community", label: "Social", icon: "community" },
  ];

  return (
    <>
      {/* Mobile : barre du haut */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line/70 bg-bg/80 px-4 py-3 backdrop-blur-md lg:hidden">
        <Logo href="/app" uid="top" />
        <Link href="/app/notifications" className="relative rounded-xl p-2 text-muted hover:text-text" aria-label={`Notifications${unread ? ` (${unread} non lues)` : ""}`}>
          <Icon name="bell" size={20} />
          {!!unread && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-magenta shadow-[0_0_8px_rgb(211_74_255)]" />}
        </Link>
      </header>

      {/* Ordinateur : barre latérale */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line/70 bg-panel/70 backdrop-blur-md lg:flex">
        <div className="px-5 pb-4 pt-5">
          <Logo href="/app" uid="side" />
        </div>
        <div className="px-4 pb-4">
          <Link href="/app/videos/upload" className="btn-primary w-full">
            <Icon name="bolt" size={16} /> Analyser ma partie
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">{nav}</div>
        {userBox}
      </aside>

      {/* Mobile : barre du bas */}
      <nav aria-label="Navigation rapide" className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
          {bottom.slice(0, 2).map((it) => (
            <BottomLink key={it.href} it={it} on={active(it.href)} />
          ))}
          <Link href="/app/videos/upload" aria-label="Analyser ma partie" className="mx-auto -mt-5 mb-1 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-accent to-magenta text-white shadow-[0_8px_24px_-6px_rgb(211_74_255/0.9)] ring-4 ring-bg">
            <Icon name="bolt" size={24} />
          </Link>
          {bottom.slice(2, 3).map((it) => (
            <BottomLink key={it.href} it={it} on={active(it.href)} />
          ))}
          <button onClick={() => setOpen(true)} aria-expanded={open} aria-controls="app-nav-drawer" className="relative flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted">
            <Icon name="menu" size={20} />
            Plus
            {!!alerts && <span className="absolute right-4 top-1.5 h-2 w-2 rounded-full bg-magenta" />}
          </button>
        </div>
      </nav>

      {/* Mobile : tiroir avec toute la navigation */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Fermer le menu" onClick={() => setOpen(false)} />
          <div id="app-nav-drawer" className="anim-rise absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between px-5 py-4">
              <Logo href="/app" uid="drawer" />
              <button className="rounded-xl p-2 text-muted hover:text-text" onClick={() => setOpen(false)} aria-label="Fermer le menu">
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="pb-4">{nav}</div>
            {userBox}
          </div>
        </div>
      )}
    </>
  );
}

function BottomLink({ it, on }: { it: Item; on: boolean }) {
  return (
    <Link href={it.href} aria-current={on ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "text-white" : "text-muted"}`}>
      <Icon name={it.icon} size={20} className={on ? "text-accent-2 drop-shadow-[0_0_6px_rgb(196_139_255/0.8)]" : ""} />
      {it.label}
    </Link>
  );
}
