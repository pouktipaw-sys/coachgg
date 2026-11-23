// Petits composants d'interface partagés (en-têtes, états vides, badges, tuiles de stats, barres…).
import Link from "next/link";
import { Icon, type IconName } from "./icons";

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** En-tête de section dans une carte : icône lumineuse + titre + action à droite. */
export function SectionHeader({ icon, title, action, sub }: { icon?: IconName; title: string; action?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && (
          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent-2">
            <Icon name={icon} size={16} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="h2 leading-tight">{title}</h2>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Tuile de statistique : valeur réelle uniquement ; « — » si inconnue. */
export function StatTile({ label, value, hint, tone = "default", icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "win" | "loss" | "warn" | "accent"; icon?: IconName }) {
  const color = { default: "text-text", win: "text-win", loss: "text-loss", warn: "text-warn", accent: "text-accent-2" }[tone];
  return (
    <div className="rounded-xl border border-line/70 bg-bg/40 p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </p>
      <p className={`stat-num mt-2 ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Barre de progression (0–100), dégradé violet → magenta. */
export function ProgressBar({ value, label, tone = "accent" }: { value: number; label: string; tone?: "accent" | "win" | "warn" }) {
  const v = Math.max(0, Math.min(100, value));
  const bar = { accent: "from-accent to-magenta", win: "from-win/70 to-win", warn: "from-warn/70 to-warn" }[tone];
  return (
    <div className="h-2 overflow-hidden rounded-full bg-bg/70" role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full bg-gradient-to-r ${bar} shadow-[0_0_10px_rgb(211_74_255/0.6)]`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

export function EmptyState({ title, text, action, icon = "target" }: { title: string; text?: React.ReactNode; action?: { href: string; label: string }; icon?: IconName }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-bg/30 p-8 text-center">
      <span aria-hidden className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent-2 shadow-[0_0_24px_-6px_rgb(146_46_255/0.7)]">
        <Icon name={icon} size={22} />
      </span>
      <p className="font-display font-semibold">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{text}</p>}
      {action && (
        <Link href={action.href} className="btn-primary mt-4">
          {action.label}
        </Link>
      )}
    </div>
  );
}

const TONES = {
  neutral: "border-line text-muted",
  info: "border-accent/40 text-accent-2 bg-accent/10",
  cyan: "border-cyan/40 text-cyan bg-cyan/10",
  ok: "border-win/40 text-win bg-win/10",
  warn: "border-warn/40 text-warn bg-warn/10",
  bad: "border-loss/40 text-loss bg-loss/10",
} as const;

export function Badge({ tone = "neutral", children, title }: { tone?: keyof typeof TONES; children: React.ReactNode; title?: string }) {
  return (
    <span className={`badge ${TONES[tone]}`} title={title}>
      {children}
    </span>
  );
}

export const RECORDING_STATUS: Record<string, { label: string; tone: keyof typeof TONES }> = {
  UPLOADING: { label: "Envoi en cours", tone: "info" },
  UPLOADED: { label: "En attente de traitement", tone: "info" },
  PROCESSING: { label: "Traitement", tone: "info" },
  READY: { label: "Prête", tone: "ok" },
  FAILED: { label: "Échec", tone: "bad" },
};

export function IntegrationNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm">
      <p className="font-medium text-warn">{title}</p>
      <div className="mt-1 text-muted">{children}</div>
    </div>
  );
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

export function formatDate(d: Date | string) {
  return new Date(d).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}
