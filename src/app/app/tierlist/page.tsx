import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { ChampIcon, ROLE_FR } from "@/components/explore/Bits";
import { MetaEmpty } from "@/components/explore/MetaEmpty";
import { requirePageUser } from "@/server/auth/page";
import { ddChampions, ddVersion, findChampion } from "@/server/riot/ddragon";
import { metaOverview, metaTierList } from "@/server/meta";

export const metadata = { title: "Tier list" };
export const dynamic = "force-dynamic";
const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
const TIER_STYLE: Record<string, string> = { "S+": "border-magenta text-magenta bg-magenta/15", S: "border-accent text-accent-2 bg-accent/15", A: "border-cyan/70 text-cyan bg-cyan/10", B: "border-win/60 text-win bg-win/10", C: "border-line text-muted", D: "border-line text-muted/70" };

export default async function TierListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageUser();
  const sp = await searchParams;
  const mode = (["RANKED", "ARAM", "ARENA"] as const).find((m) => m === sp.mode) ?? "RANKED";
  const ov = await metaOverview(sp.patch, mode);
  const role = mode !== "RANKED" ? "ANY" : ROLES.includes(sp.role as (typeof ROLES)[number]) ? sp.role! : "MIDDLE";
  const [v, champs] = await Promise.all([ddVersion().catch(() => null), ddChampions().catch(() => [])]);
  const tl = ov ? await metaTierList(ov.key, role) : null;
  const MODES = [["RANKED", "Classée solo/duo"], ["ARAM", "ARAM"], ["ARENA", "Arena"]] as const;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Explorer" title="Tier list" subtitle={ov ? `Patch ${ov.patch} · ${ov.games.toLocaleString("fr-FR")} parties ${mode === "RANKED" ? "classées solo/duo" : mode} collectées (joueurs Challenger et Grand maître).` : "Classement des champions par rôle, à partir de parties classées publiques."} />
      <nav aria-label="Mode" className="flex flex-wrap gap-1.5">
        {MODES.map(([k, l]) => (
          <Link key={k} href={`/app/tierlist?mode=${k}`} aria-current={mode === k ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs ${mode === k ? "border-magenta bg-magenta/20 text-white" : "border-line text-muted hover:text-text"}`}>{l}</Link>
        ))}
      </nav>
      {!ov || !tl ? (
        <MetaEmpty />
      ) : (
        <>
          <nav aria-label="Rôle" className="flex flex-wrap gap-1.5">
            {mode === "RANKED" && ROLES.map((r) => (
              <Link key={r} href={`/app/tierlist?role=${r}${sp.patch ? `&patch=${sp.patch}` : ""}`} aria-current={role === r ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-xs ${role === r ? "border-accent bg-accent/20 text-white" : "border-line text-muted hover:text-text"}`}>{ROLE_FR[r]}</Link>
            ))}
            {ov.patches.length > 1 && (
              <span className="ml-auto flex gap-1 text-xs">
                {ov.patches.slice(0, 4).map((p) => (
                  <Link key={p.patch} href={`/app/tierlist?mode=${mode}&role=${role}&patch=${p.patch}`} className={`rounded-full border px-2.5 py-1 ${p.patch === ov.patch ? "border-cyan text-cyan" : "border-line text-muted"}`}>{p.patch}</Link>
                ))}
              </span>
            )}
          </nav>
          <p className="text-xs text-muted">Classement par taux de victoire ajusté à la taille de l&apos;échantillon (les champions peu joués sont ramenés vers 50 %) ; minimum {tl.minGames} parties. Les paliers sont relatifs aux autres champions du rôle.</p>
          {tl.rows.length === 0 ? (
            <p className="card text-sm text-muted">Pas encore assez de parties pour ce rôle sur ce patch.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line/80 bg-panel/60">
              <table className="w-full min-w-[620px] text-sm" data-testid="tierlist">
                <thead className="bg-panel-2/80 text-left text-[11px] uppercase tracking-[0.12em] text-muted">
                  <tr><th className="px-3 py-2">Palier</th><th className="px-3 py-2">Champion</th><th className="px-3 py-2">Victoires</th><th className="px-3 py-2">Sélection</th><th className="px-3 py-2">Bannissement</th><th className="px-3 py-2">Parties</th></tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {tl.rows.map((r) => {
                    const c = findChampion(champs, r.championId);
                    return (
                      <tr key={r.championId} className="hover:bg-accent/[0.05]">
                        <td className="px-3 py-2"><span className={`badge font-display font-bold ${TIER_STYLE[r.tier]}`}>{r.tier}</span></td>
                        <td className="px-3 py-2">
                          <Link href={c ? `/app/champions/${c.id}?role=${role}&mode=${mode}` : "#"} className="flex items-center gap-2.5 hover:text-accent-2">
                            <ChampIcon version={v} file={c?.image.full} name={c?.name ?? `#${r.championId}`} size={32} />
                            <span className="font-medium">{c?.name ?? `#${r.championId}`}</span>
                          </Link>
                        </td>
                        <td className={`px-3 py-2 font-display tabular-nums ${r.winrate >= 52 ? "text-win" : r.winrate < 48 ? "text-loss" : ""}`}>{String(r.winrate).replace(".", ",")} %</td>
                        <td className="px-3 py-2 tabular-nums">{String(r.pickrate).replace(".", ",")} %</td>
                        <td className="px-3 py-2 tabular-nums text-muted">{String(r.banrate).replace(".", ",")} %</td>
                        <td className="px-3 py-2 tabular-nums text-muted">{r.games.toLocaleString("fr-FR")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
