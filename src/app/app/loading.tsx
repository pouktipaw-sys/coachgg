export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Chargement">
      <div className="anim-pulse h-8 w-64 rounded bg-panel-2" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="anim-pulse h-32 rounded-xl bg-panel" />)}
      </div>
    </div>
  );
}
