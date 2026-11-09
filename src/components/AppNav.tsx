"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "./Logo";

type Item = { href: string; label: string; icon: string; badge?: number };

export function AppNav({ user, unread, invites, isAdmin }: { user: { displayName: string }; unread: number; invites: number; isAdmin: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items: Item[] = [
    { href: "/app", label: "Tableau de bord", icon: "◧" },
    { href: "/app/videos", label: "Vidéos & coaching", icon: "▶" },
    { href: "/app/clips", label: "Clips", icon: "✂" },
    { href: "/app/matches", label: "Matchs & stats", icon: "▤" },
    { href: "/app/progress", label: "Progression", icon: "↗" },
    { href: "/app/goals", label: "Objectifs", icon: "◇" },
    { href: "/app/coach", label: "Coach", icon: "✦" },
    { href: "/app/teams", label: "Groupes", icon: "◎" },
    { href: "/app/invitations", label: "Invitations", icon: "✉", badge: invites },
    { href: "/app/notifications", label: "Notifications", icon: "◔", badge: unread },
    { href: "/app/capture", label: "Capture PC", icon: "⬚" },
    { href: "/app/settings", label: "Paramètres", icon: "⚙" },
    { href: "/app/support", label: "Aide", icon: "?" },
    ...(isAdmin ? [{ href: "/app/admin", label: "Administration", icon: "⛭" }] : []),
  ];
  const active = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-3 lg:hidden">
        <Logo href="/app" />
        <button className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="app-nav">
          Menu
        </button>
      </div>
      <aside
        id="app-nav"
        className={`${open ? "block" : "hidden"} border-r border-line bg-panel lg:sticky lg:top-0 lg:block lg:h-screen lg:w-60 lg:shrink-0`}
      >
        <div className="hidden px-5 py-5 lg:block">
          <Logo href="/app" />
        </div>
        <nav className="flex flex-col gap-0.5 px-3 py-2" aria-label="Navigation principale">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              onClick={() => setOpen(false)}
              aria-current={active(it.href) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                active(it.href) ? "bg-accent/15 text-text" : "text-muted hover:bg-panel-2 hover:text-text"
              }`}
            >
              <span aria-hidden className="w-4 text-center">{it.icon}</span>
              <span className="flex-1">{it.label}</span>
              {!!it.badge && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{it.badge}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-4 border-t border-line px-5 py-4 text-sm">
          <p className="truncate text-muted">{user.displayName}</p>
          <button onClick={logout} className="mt-2 text-xs text-muted underline hover:text-text">Se déconnecter</button>
        </div>
      </aside>
    </>
  );
}
