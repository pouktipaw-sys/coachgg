"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg space-y-3 text-center">
      <h1 className="h1">Une erreur est survenue</h1>
      <p className="text-sm text-muted">Le chargement de cette page a échoué. Vos données ne sont pas affectées.</p>
      <button className="btn-primary" onClick={reset}>Réessayer</button>
    </div>
  );
}
