import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm uppercase tracking-widest text-muted">404</p>
      <h1 className="h1">Introuvable</h1>
      <p className="max-w-md text-sm text-muted">Cette page n&apos;existe pas, ou vous n&apos;avez pas l&apos;autorisation d&apos;y accéder.</p>
      <Link href="/app" className="btn-primary mt-2">Retour au tableau de bord</Link>
    </main>
  );
}
