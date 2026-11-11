// Graphique « en toile » : profil de joueur sur les dimensions de la note (0 à 10),
// tes 10 dernières parties comparées aux 10 précédentes. Survol d'un point = valeur exacte.
type Axis = { key: string; label: string; now: number | null; before: number | null };

// Palette validée pour fond sombre (slots 1 et 2) ; « avant » est aussi en pointillé (double encodage).
const NOW = "#3987e5";
const BEFORE = "#d95926";

export function RadarChart({ axes, size = 340 }: { axes: Axis[]; size?: number }) {
  const n = axes.length;
  if (n < 3) return <p className="text-sm text-muted">Pas assez de dimensions mesurées pour tracer le profil.</p>;
  // Marges latérales pour que les étiquettes (« Participation ») ne soient jamais coupées.
  const PAD_X = 70;
  const W = size + 2 * PAD_X;
  const c = size / 2;
  const cx = W / 2;
  const R = size / 2 - 48;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + Math.cos(a) * R * (v / 10), y: c + Math.sin(a) * R * (v / 10) };
  };
  const poly = (sel: (a: Axis) => number | null) =>
    axes.every((a) => sel(a) != null) ? axes.map((a, i) => pt(i, sel(a)!)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : null;
  const nowPoly = poly((a) => a.now);
  const beforePoly = poly((a) => a.before);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${size}`} className="mx-auto w-full max-w-md" role="img" aria-label="Profil de joueur : maintenant comparé à avant" data-testid="radar">
        {[2.5, 5, 7.5, 10].map((v) => (
          <polygon key={v} points={axes.map((_, i) => pt(i, v)).map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#232b3b" strokeWidth={1} />
        ))}
        {axes.map((a, i) => {
          const end = pt(i, 10);
          const lab = pt(i, 11.8);
          return (
            <g key={a.key}>
              <line x1={cx} y1={c} x2={end.x} y2={end.y} stroke="#232b3b" />
              <text x={lab.x} y={lab.y} fontSize={12} fill="#c9d1e0" textAnchor={Math.abs(lab.x - cx) < 8 ? "middle" : lab.x > cx ? "start" : "end"} dominantBaseline="middle">
                {a.label}
              </text>
            </g>
          );
        })}
        {beforePoly && <polygon points={beforePoly} fill={BEFORE} fillOpacity={0.08} stroke={BEFORE} strokeWidth={2} strokeDasharray="6 4" />}
        {nowPoly && <polygon points={nowPoly} fill={NOW} fillOpacity={0.18} stroke={NOW} strokeWidth={2} />}
        {axes.map((a, i) =>
          a.now != null ? (
            <circle key={a.key} cx={pt(i, a.now).x} cy={pt(i, a.now).y} r={5} fill={NOW} stroke="#0b0e15" strokeWidth={2}>
              <title>{`${a.label} : ${a.now}/10 maintenant${a.before != null ? ` · ${a.before}/10 avant` : ""}`}</title>
            </circle>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={NOW} strokeWidth="2" /></svg> 10 dernières parties</span>
        {beforePoly && <span className="flex items-center gap-1"><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={BEFORE} strokeWidth="2" strokeDasharray="6 4" /></svg> 10 précédentes</span>}
      </figcaption>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">Voir les valeurs</summary>
        <table className="mt-1 w-full">
          <thead><tr className="text-left"><th>Dimension</th><th>Maintenant</th><th>Avant</th><th>Évolution</th></tr></thead>
          <tbody>
            {axes.map((a) => (
              <tr key={a.key}>
                <td>{a.label}</td>
                <td className="font-mono text-text">{a.now ?? "—"}</td>
                <td className="font-mono">{a.before ?? "—"}</td>
                <td className="font-mono">{a.now != null && a.before != null ? `${a.now - a.before >= 0 ? "+" : ""}${Math.round((a.now - a.before) * 10) / 10}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
