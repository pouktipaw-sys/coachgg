// Petits composants d'interface partagés (états vides, badges de statut…).
import Link from "next/link";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-8 text-center">
      <p className="font-medium">{title}</p>
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
    <div className="rounded-xl border border-warn/30 bg-warn/5 p-4 text-sm">
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
