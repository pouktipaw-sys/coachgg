// Petits éléments visuels de la page Amis (serveur).
import { avatarHue, type Badge } from "@/lib/badges";

const TIER_COLOR: Record<string, string> = {
  IRON: "#6b6b6b", BRONZE: "#a0643c", SILVER: "#9aa7b4", GOLD: "#e2b04a", PLATINUM: "#3fb6a8", EMERALD: "#2ecc71",
  DIAMOND: "#5b8cff", MASTER: "#b45cff", GRANDMASTER: "#ff4d4d", CHALLENGER: "#f5d76e",
};
const TIER_FR: Record<string, string> = {
  IRON: "Fer", BRONZE: "Bronze", SILVER: "Argent", GOLD: "Or", PLATINUM: "Platine", EMERALD: "Émeraude",
  DIAMOND: "Diamant", MASTER: "Maître", GRANDMASTER: "Grand maître", CHALLENGER: "Challenger",
};

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const h = avatarHue(name);
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 50) % 360} 70% 35%))` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function RankChip({ rank }: { rank: { queue: string; tier: string; division: string; lp: number }[] | null }) {
  const r = rank?.find((x) => x.queue === "RANKED_SOLO_5x5") ?? rank?.[0];
  if (!r) return <span className="badge text-muted">Non classé</span>;
  const apex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(r.tier);
  return (
    <span className="badge font-medium" style={{ borderColor: TIER_COLOR[r.tier], color: TIER_COLOR[r.tier] }}>
      {TIER_FR[r.tier] ?? r.tier}{apex ? "" : ` ${r.division}`} · {r.lp} PL
    </span>
  );
}

export function FormDots({ form }: { form: string[] }) {
  if (!form.length) return <span className="text-xs text-muted">Aucune partie</span>;
  return (
    <span className="inline-flex gap-1" aria-label={`Forme : ${form.join(" ")}`}>
      {form.map((r, i) => (
        <span key={i} className={`grid h-5 w-5 place-items-center rounded text-[10px] font-bold ${r === "V" ? "bg-win/20 text-win" : "bg-loss/20 text-loss"}`}>{r}</span>
      ))}
    </span>
  );
}

export function StreakTag({ streak }: { streak: { kind: "V" | "D"; n: number } | null }) {
  if (!streak || streak.n < 2) return null;
  return streak.kind === "V" ? (
    <span className="badge border-warn/50 text-warn">🔥 {streak.n} victoires d&apos;affilée</span>
  ) : (
    <span className="badge text-muted">🧊 {streak.n} défaites d&apos;affilée</span>
  );
}

export function BadgeList({ badges }: { badges: Badge[] }) {
  if (!badges.length) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <li key={b.key} className="badge border-accent/40" title={b.detail}>{b.icon} {b.label}</li>
      ))}
    </ul>
  );
}
