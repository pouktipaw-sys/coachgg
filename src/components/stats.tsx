// Éléments de présentation des statistiques et des notes.
import { COMPONENT_DEFINITIONS, type ComponentKey } from "@/lib/scoring/config";
import type { ComponentResult } from "@/lib/scoring/engine";

export const ROLE_LABELS: Record<string, string> = { TOP: "Haut", JUNGLE: "Jungle", MIDDLE: "Milieu", BOTTOM: "Bas (tireur)", UTILITY: "Soutien" };
export const MODE_LABELS: Record<string, string> = {
  RANKED_SOLO: "Classée solo/duo",
  RANKED_FLEX: "Classée flexible",
  NORMAL: "Normale",
  ARAM: "ARAM",
  CUSTOM: "Personnalisée",
  OTHER: "Autre",
};
export const RELIABILITY: Record<string, { label: string; tone: string }> = {
  high: { label: "Fiabilité élevée", tone: "text-win" },
  medium: { label: "Fiabilité moyenne", tone: "text-accent-2" },
  low: { label: "Fiabilité faible", tone: "text-warn" },
  insufficient: { label: "Données insuffisantes", tone: "text-muted" },
};

export function ScorePill({ score, reliability }: { score: number | null; reliability?: string | null }) {
  if (score == null)
    return <span className="badge border-line text-muted" title="Données insuffisantes pour une note">—</span>;
  const tone = score >= 7 ? "border-win/50 text-win" : score >= 4.5 ? "border-accent/50 text-accent-2" : "border-warn/50 text-warn";
  return (
    <span className={`badge ${tone} font-mono`} title={reliability ? RELIABILITY[reliability]?.label : undefined}>
      {score.toFixed(1)}
      {reliability === "low" && <span aria-label="fiabilité faible">*</span>}
    </span>
  );
}

export function ComponentBars({ components }: { components: ComponentResult[] }) {
  return (
    <ul className="space-y-3">
      {components.map((c) => (
        <li key={c.key}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span title={COMPONENT_DEFINITIONS[c.key as ComponentKey]}>{c.label}</span>
            <span className="font-mono text-xs text-muted">
              {c.available ? `${c.display} · ${c.score}/10 · poids ${Math.round(c.weight * 100)} %` : "non mesuré"}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded bg-panel-2" aria-hidden>
            {c.available && (
              <div
                className={`h-full ${c.score! >= 7 ? "bg-win" : c.score! >= 4.5 ? "bg-accent" : "bg-warn"}`}
                style={{ width: `${(c.score! / 10) * 100}%` }}
              />
            )}
          </div>
          {!c.available && <p className="mt-0.5 text-xs text-muted">{c.missingReason}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Courbe simple (SVG) des notes récentes — uniquement des valeurs réelles. */
export function Sparkline({ values, height = 60 }: { values: { label: string; value: number }[]; height?: number }) {
  if (values.length < 2) return <p className="text-sm text-muted">Au moins deux parties notées sont nécessaires pour afficher une évolution.</p>;
  const w = 320;
  const pts = values.map((v, i) => ({ x: (i / (values.length - 1)) * (w - 16) + 8, y: height - 6 - (v.value / 10) * (height - 12) }));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={`Évolution des notes : ${values.map((v) => v.value).join(", ")}`}>
      <line x1={8} x2={w - 8} y1={height - 6 - 0.5 * (height - 12)} y2={height - 6 - 0.5 * (height - 12)} stroke="#232b3b" strokeDasharray="4 4" />
      <path d={d} fill="none" stroke="#4c9dff" strokeWidth={2} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#4c9dff">
          <title>{`${values[i]!.label} : ${values[i]!.value}/10`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function fmtDuration(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function fmtNum(n: number | null | undefined) {
  return n == null ? "—" : n.toLocaleString("fr-FR");
}

export type RankEntry = { queue: string; label: string; tier: string; division: string; lp: number; wins: number; losses: number };

const TIERS: Record<string, string> = {
  IRON: "Fer", BRONZE: "Bronze", SILVER: "Argent", GOLD: "Or", PLATINUM: "Platine", EMERALD: "Émeraude",
  DIAMOND: "Diamant", MASTER: "Maître", GRANDMASTER: "Grand maître", CHALLENGER: "Challenger",
};

export function formatRank(r: RankEntry) {
  const apex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(r.tier);
  return `${r.label} : ${TIERS[r.tier] ?? r.tier}${apex ? "" : ` ${r.division}`} · ${r.lp} PL · ${r.wins}V/${r.losses}D`;
}

/** Courbe cumulative par minute (or, CS) — valeurs réelles de la timeline Riot. */
export function MinuteChart({ values, label, color = "#4c9dff", height = 90 }: { values: number[]; label: string; color?: string; height?: number }) {
  if (values.length < 2) return null;
  const w = 360;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => ({ x: 30 + (i / (values.length - 1)) * (w - 40), y: height - 18 - (v / max) * (height - 28) }));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <figure>
      <figcaption className="mb-1 text-xs text-muted">{label} — {values[values.length - 1]!.toLocaleString("fr-FR")} à {values.length - 1} min</figcaption>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={`${label} par minute : ${values.join(", ")}`}>
        <line x1={30} x2={w - 10} y1={height - 18} y2={height - 18} stroke="#232b3b" />
        <text x={0} y={12} fontSize={10} fill="#8b95a8">{max.toLocaleString("fr-FR")}</text>
        <text x={30} y={height - 4} fontSize={10} fill="#8b95a8">0 min</text>
        <text x={w - 10} y={height - 4} fontSize={10} fill="#8b95a8" textAnchor="end">{values.length - 1} min</text>
        <path d={d} fill="none" stroke={color} strokeWidth={2} />
      </svg>
    </figure>
  );
}
