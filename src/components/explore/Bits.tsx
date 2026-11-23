// Petits éléments d'affichage des pages d'exploration (icônes officielles Data Dragon, rang, taux de victoire).
/* eslint-disable @next/next/no-img-element */
const TIERS: Record<string, string> = {
  IRON: "Fer", BRONZE: "Bronze", SILVER: "Argent", GOLD: "Or", PLATINUM: "Platine", EMERALD: "Émeraude",
  DIAMOND: "Diamant", MASTER: "Maître", GRANDMASTER: "Grand maître", CHALLENGER: "Challenger",
};
const TIER_COLOR: Record<string, string> = {
  IRON: "#8b8b8b", BRONZE: "#b0703c", SILVER: "#a9b7c6", GOLD: "#e8b64c", PLATINUM: "#4fd1c5", EMERALD: "#34d399",
  DIAMOND: "#7aa7ff", MASTER: "#c084fc", GRANDMASTER: "#f87171", CHALLENGER: "#fbbf24",
};

export type Rank = { queue: string; label: string; tier: string; division: string; lp: number; wins: number; losses: number };

export function tierLabel(r: Pick<Rank, "tier" | "division">) {
  const apex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(r.tier);
  return `${TIERS[r.tier] ?? r.tier}${apex ? "" : ` ${r.division}`}`;
}

export function RankBadge({ r, compact = false }: { r: Rank | null | undefined; compact?: boolean }) {
  if (!r) return <span className="text-xs text-muted">Non classé</span>;
  const c = TIER_COLOR[r.tier] ?? "#a7a0bd";
  const games = r.wins + r.losses;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="h-2.5 w-2.5 rotate-45 rounded-[2px]" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
      <span className="font-display font-semibold" style={{ color: c }}>{tierLabel(r)}</span>
      {!compact && <span className="text-xs text-muted">· {r.lp} PL · {games ? Math.round((r.wins / games) * 100) : 0} % ({r.wins}V/{r.losses}D)</span>}
    </span>
  );
}

export function ChampIcon({ version, file, name, size = 36 }: { version: string | null; file: string | null | undefined; name: string; size?: number }) {
  if (!version || !file)
    return (
      <span aria-label={name} className="grid shrink-0 place-items-center rounded-lg border border-line bg-panel-2 font-display text-[10px] font-bold text-accent-2" style={{ width: size, height: size }}>
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  return <img src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${file}`} alt={name} width={size} height={size} className="shrink-0 rounded-lg border border-line/80" loading="lazy" />;
}

export function ItemIcon({ version, id, name, size = 30 }: { version: string | null; id: number; name: string; size?: number }) {
  if (!version) return <span className="badge border-line text-muted">{name}</span>;
  return <img src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`} alt={name} title={name} width={size} height={size} className="shrink-0 rounded-md border border-line/80" loading="lazy" />;
}

/** Taux de victoire coloré, toujours accompagné du nombre de parties. */
export function Winrate({ wr, games }: { wr: number | null; games: number }) {
  if (wr == null) return <span className="text-muted">—</span>;
  const tone = games < 3 ? "text-muted" : wr >= 55 ? "text-win" : wr < 45 ? "text-loss" : "text-text";
  return (
    <span className={`tabular-nums ${tone}`}>
      <span className="font-display font-semibold">{wr} %</span> <span className="text-xs text-muted">({games})</span>
    </span>
  );
}

export const ROLE_FR: Record<string, string> = { TOP: "Haut", JUNGLE: "Jungle", MIDDLE: "Milieu", BOTTOM: "Tireur", UTILITY: "Soutien" };
