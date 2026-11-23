// Éléments de présentation des statistiques et des notes.
import { COMPONENT_DEFINITIONS, type ComponentKey } from "@/lib/scoring/config";
import type { ComponentResult } from "@/lib/scoring/engine";

export const ROLE_LABELS: Record<string, string> = { TOP: "Haut", JUNGLE: "Jungle", MIDDLE: "Milieu", BOTTOM: "Bas (tireur)", UTILITY: "Soutien" };
export const MODE_LABELS: Record<string, string> = {
  RANKED_SOLO: "Classée solo/duo",
  RANKED_FLEX: "Classée flexible",
  NORMAL: "Normale",
  ARAM: "ARAM",
  ARENA: "Arena",
  URF: "URF",
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
  const tone = score >= 7 ? "border-win/50 bg-win/10 text-win shadow-[0_0_12px_-4px_rgb(52_211_153/0.8)]" : score >= 4.5 ? "border-accent/50 bg-accent/10 text-accent-2" : "border-warn/50 bg-warn/10 text-warn";
  return (
    <span className={`badge ${tone} font-display text-sm font-bold tabular-nums`} title={reliability ? RELIABILITY[reliability]?.label : undefined}>
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
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg/70" aria-hidden>
            {c.available && (
              <div
                className={`h-full rounded-full ${c.score! >= 7 ? "bg-gradient-to-r from-win/70 to-win" : c.score! >= 4.5 ? "bg-gradient-to-r from-accent to-magenta" : "bg-gradient-to-r from-warn/70 to-warn"}`}
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
export function Sparkline({ values, height = 60, max = 10, unit = "/10" }: { values: { label: string; value: number }[]; height?: number; max?: number; unit?: string }) {
  if (values.length < 2) return <p className="text-sm text-muted">Au moins deux parties notées sont nécessaires pour afficher une évolution.</p>;
  const w = 320;
  const pts = values.map((v, i) => ({ x: (i / (values.length - 1)) * (w - 16) + 8, y: height - 6 - (v.value / max) * (height - 12) }));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${d} L${pts.at(-1)!.x.toFixed(1)},${height} L${pts[0]!.x.toFixed(1)},${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full overflow-visible" role="img" aria-label={`Évolution : ${values.map((v) => `${v.value}${unit}`).join(", ")}`}>
      <defs>
        <linearGradient id="spark-line" x1="0" x2="1"><stop offset="0" stopColor="#922eff" /><stop offset="1" stopColor="#d34aff" /></linearGradient>
        <linearGradient id="spark-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#922eff" stopOpacity="0.35" /><stop offset="1" stopColor="#922eff" stopOpacity="0" /></linearGradient>
      </defs>
      <line x1={8} x2={w - 8} y1={height - 6 - 0.5 * (height - 12)} y2={height - 6 - 0.5 * (height - 12)} stroke="#30234b" strokeDasharray="4 4" />
      <path d={area} fill="url(#spark-area)" />
      <path d={d} fill="none" stroke="url(#spark-line)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4.5 : 3} fill={i === pts.length - 1 ? "#d34aff" : "#922eff"} stroke="#080812" strokeWidth={1.5}>
          <title>{`${values[i]!.label} : ${values[i]!.value}${unit}`}</title>
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
export function MinuteChart({ values, label, color = "#c48bff", height = 90 }: { values: number[]; label: string; color?: string; height?: number }) {
  if (values.length < 2) return null;
  const w = 360;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => ({ x: 30 + (i / (values.length - 1)) * (w - 40), y: height - 18 - (v / max) * (height - 28) }));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <figure>
      <figcaption className="mb-1 text-xs text-muted">{label} — {values[values.length - 1]!.toLocaleString("fr-FR")} à {values.length - 1} min</figcaption>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={`${label} par minute : ${values.join(", ")}`}>
        <line x1={30} x2={w - 10} y1={height - 18} y2={height - 18} stroke="#30234b" />
        <text x={0} y={12} fontSize={10} fill="#a7a0bd">{max.toLocaleString("fr-FR")}</text>
        <text x={30} y={height - 4} fontSize={10} fill="#a7a0bd">0 min</text>
        <text x={w - 10} y={height - 4} fontSize={10} fill="#a7a0bd" textAnchor="end">{values.length - 1} min</text>
        <path d={d} fill="none" stroke={color} strokeWidth={2} />
      </svg>
    </figure>
  );
}

/** Écart minute par minute (toi − adversaire) : au-dessus de zéro en vert, en dessous en rouge. Valeurs réelles uniquement. */
export function DiffChart({ values, label, unit, height = 110 }: { values: number[]; label: string; unit: string; height?: number }) {
  if (values.length < 2) return null;
  const w = 360;
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const mid = height / 2;
  const x = (i: number) => 34 + (i / (values.length - 1)) * (w - 44);
  const y = (v: number) => mid - (v / max) * (mid - 12);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(values.length - 1).toFixed(1)},${mid} L${x(0).toFixed(1)},${mid} Z`;
  const last = values.at(-1)!;
  const id = `diff-${label.replace(/\W/g, "")}`;
  return (
    <figure>
      <figcaption className="mb-1 text-xs text-muted">
        {label} — <span className={last >= 0 ? "text-win" : "text-loss"}>{last >= 0 ? "+" : "−"}{Math.abs(last).toLocaleString("fr-FR")} {unit}</span> à {values.length - 1} min
      </figcaption>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={`${label} par minute : ${values.join(", ")}`}>
        <defs>
          <clipPath id={`${id}-up`}><rect x="0" y="0" width={w} height={mid} /></clipPath>
          <clipPath id={`${id}-down`}><rect x="0" y={mid} width={w} height={mid} /></clipPath>
        </defs>
        <line x1={34} x2={w - 10} y1={mid} y2={mid} stroke="#30234b" />
        <text x={0} y={14} fontSize={10} fill="#a7a0bd">+{max.toLocaleString("fr-FR")}</text>
        <text x={0} y={height - 4} fontSize={10} fill="#a7a0bd">−{max.toLocaleString("fr-FR")}</text>
        <path d={area} fill="#34d399" fillOpacity={0.22} clipPath={`url(#${id}-up)`} />
        <path d={area} fill="#f87171" fillOpacity={0.22} clipPath={`url(#${id}-down)`} />
        <path d={d} fill="none" stroke="#f5f2ff" strokeWidth={1.8} strokeLinejoin="round" />
      </svg>
    </figure>
  );
}
