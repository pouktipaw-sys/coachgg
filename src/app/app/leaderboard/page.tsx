import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/errors";
import { PLATFORMS } from "@/server/riot/client";
import { leaderboard } from "@/server/riot/explorer";

export const metadata = { title: "Classement" };
export const dynamic = "force-dynamic";

const TIERS = [["challenger", "Challenger"], ["grandmaster", "Grand maître"], ["master", "Maître"]] as const;

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const mine = await prisma.gameIdentity.findFirst({ where: { userId: user.id, isPrimary: true }, select: { platform: true } });
  const platform = sp.platform ?? mine?.platform ?? "EUW1";
  const tier = TIERS.some(([k]) => k === sp.tier) ? sp.tier! : "challenger";
  const queue = sp.queue === "RANKED_FLEX_SR" ? "RANKED_FLEX_SR" : "RANKED_SOLO_5x5";
  let data: Awaited<ReturnType<typeof leaderboard>> | null = null;
  let error: string | null = null;
  try {
    data = await leaderboard(platform, tier, queue);
  } catch (e) {
    error = e instanceof HttpError ? e.message : "Classement indisponible pour le moment.";
  }
  const href = (o: Record<string, string>) => `/app/leaderboard?${new URLSearchParams({ platform, tier, queue, ...o })}`;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Explorer" title="Classement" subtitle="Les meilleurs joueurs de chaque serveur (ligues Challenger, Grand maître et Maître, données Riot)." />
      <form className="card flex flex-wrap items-end gap-2" aria-label="Filtres du classement">
        <div>
          <label className="label" htmlFor="lb-p">Serveur</label>
          <select id="lb-p" name="platform" defaultValue={platform} className="input">{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
        <div>
          <label className="label" htmlFor="lb-q">File</label>
          <select id="lb-q" name="queue" defaultValue={queue} className="input">
            <option value="RANKED_SOLO_5x5">Classée solo/duo</option>
            <option value="RANKED_FLEX_SR">Classée flexible</option>
          </select>
        </div>
        <input type="hidden" name="tier" value={tier} />
        <button className="btn-primary">Afficher</button>
        <nav aria-label="Ligue" className="ml-auto flex gap-1">
          {TIERS.map(([k, l]) => (
            <Link key={k} href={href({ tier: k })} aria-current={tier === k ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-xs ${tier === k ? "border-accent bg-accent/20 text-white" : "border-line text-muted hover:text-text"}`}>{l}</Link>
          ))}
        </nav>
      </form>
      {error && <p role="alert" className="card border-loss/40 text-sm text-loss">{error}</p>}
      {data && (
        <>
          <p className="text-xs text-muted">{data.total} joueur(s) dans la ligue · 100 premiers affichés · mis à jour toutes les 10 minutes.</p>
          <div className="overflow-x-auto rounded-2xl border border-line/80 bg-panel/60">
            <table className="w-full min-w-[620px] text-sm" data-testid="leaderboard">
              <thead className="bg-panel-2/80 text-left text-[11px] uppercase tracking-[0.12em] text-muted">
                <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Joueur</th><th className="px-3 py-2">PL</th><th className="px-3 py-2">V / D</th><th className="px-3 py-2">Victoires</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {data.entries.map((e) => (
                  <tr key={e.puuid} className="hover:bg-accent/[0.05]">
                    <td className={`px-3 py-2 font-display font-bold ${e.position <= 3 ? "text-gold" : "text-muted"}`}>{e.position}</td>
                    <td className="px-3 py-2">
                      <Link className="font-medium hover:text-accent-2" href={`/app/players?puuid=${encodeURIComponent(e.puuid)}&platform=${data!.platform}`}>{e.riotId ?? "Voir le joueur"}</Link>
                    </td>
                    <td className="px-3 py-2 font-display tabular-nums text-accent-2">{e.lp.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-2 tabular-nums text-muted">{e.wins} / {e.losses}</td>
                    <td className={`px-3 py-2 tabular-nums ${(e.winrate ?? 0) >= 55 ? "text-win" : ""}`}>{e.winrate ?? "—"} %</td>
                    <td className="px-3 py-2 text-xs">{e.hotStreak && <span className="badge border-magenta/50 text-magenta">Série de victoires</span>}{e.freshBlood && <span className="badge ml-1 border-cyan/50 text-cyan">Nouveau</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
