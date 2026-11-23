import Link from "next/link";
import { EmptyState, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import { ChampIcon, RankBadge, ROLE_FR, Winrate } from "@/components/explore/Bits";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/errors";
import { PLATFORMS } from "@/server/riot/client";
import { ddChampions, ddVersion, findChampion } from "@/server/riot/ddragon";
import { lookupByPuuid, lookupPlayer } from "@/server/riot/explorer";
import { sampleNote } from "@/lib/riot/insights";

export const metadata = { title: "Recherche de joueur" };

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const n1 = (x: number | null) => (x == null ? "—" : String(x).replace(".", ","));

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const ids = await prisma.gameIdentity.findMany({ where: { userId: user.id }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
  const q = sp.q?.trim() ?? "";
  const platform = sp.platform ?? ids[0]?.platform ?? "EUW1";
  let data: Awaited<ReturnType<typeof lookupPlayer>> | null = null;
  let error: string | null = null;
  if (q || sp.puuid) {
    try {
      data = sp.puuid && !q ? await lookupByPuuid(sp.puuid, platform, { page: Math.max(0, Number(sp.page) || 0) }) : await lookupPlayer(q, platform, { page: Math.max(0, Number(sp.page) || 0) });
    } catch (e) {
      error = e instanceof HttpError ? e.message : "Recherche impossible pour le moment.";
    }
  }
  const [v, champs] = await Promise.all([ddVersion().catch(() => null), ddChampions().catch(() => [])]);
  const icon = (name: string) => findChampion(champs, name)?.image.full;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Explorer" title="Recherche de joueur" subtitle="Rang, champions et dernières parties de n'importe quel joueur (données publiques de Riot)." />

      <form className="card-glow flex flex-wrap items-end gap-2" role="search" aria-label="Chercher un joueur">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="q">Riot ID</label>
          <input id="q" name="q" defaultValue={q} className="input" placeholder="Pseudo#TAG" required autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="platform">Serveur</label>
          <select id="platform" name="platform" defaultValue={platform} className="input">
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button className="btn-primary">Chercher</button>
        {ids.length > 0 && (
          <div className="flex w-full flex-wrap gap-1.5 text-xs">
            <span className="text-muted">Mes comptes :</span>
            {ids.map((i) => (
              <Link key={i.id} className="rounded-full border border-line px-2 py-0.5 text-muted hover:border-accent/60 hover:text-text" href={`/app/players?q=${encodeURIComponent(`${i.gameName}#${i.tagLine}`)}&platform=${i.platform}`}>
                {i.gameName}#{i.tagLine}
              </Link>
            ))}
          </div>
        )}
      </form>

      {error && <p role="alert" className="card border-loss/40 text-sm text-loss">{error}</p>}

      {!q && !sp.puuid && !error && <EmptyState icon="friends" title="Cherche un joueur" text="Tape son Riot ID (Pseudo#TAG) et choisis son serveur. Pratique pour scouter tes adversaires ou comparer avec tes amis." />}

      {data && (
        <>
          <section className="card-glow flex flex-wrap items-center justify-between gap-4" data-testid="player-profile">
            <div>
              <p className="eyebrow">{data.account.platform}</p>
              <h2 className="font-display text-2xl font-bold">{data.account.gameName}<span className="text-muted">#{data.account.tagLine}</span></h2>
              <div className="mt-1 flex flex-col gap-0.5 text-sm">
                {data.ranks.length ? data.ranks.map((r) => <span key={r.queue}><span className="text-xs text-muted">{r.label} :</span> <RankBadge r={r} /></span>) : <span className="text-muted">Non classé cette saison.</span>}
              </div>
            </div>
            <Link className="btn-cyan" href={`/app/live?q=${encodeURIComponent(`${data.account.gameName}#${data.account.tagLine}`)}&platform=${data.account.platform}`}>Voir sa partie en cours</Link>
          </section>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Résumé des dernières parties">
            <StatTile icon="trophy" label="Victoires" value={data.summary.winrate == null ? "—" : `${data.summary.winrate} %`} tone={(data.summary.winrate ?? 0) >= 50 ? "win" : "loss"} hint={`${data.summary.wins}V / ${data.summary.games - data.summary.wins}D · ${sampleNote(data.summary.games)}`} />
            <StatTile icon="sword" label="KDA" value={n1(data.summary.kda)} tone="accent" hint={`${n1(data.summary.killsAvg)} / ${n1(data.summary.deathsAvg)} / ${n1(data.summary.assistsAvg)}`} />
            <StatTile icon="coin" label="Sbires / min" value={n1(data.summary.csMin)} />
            <StatTile icon="stats" label="Rôle principal" value={data.roles[0] ? ROLE_FR[data.roles[0].name] ?? data.roles[0].name : "—"} hint={data.roles[0] ? `${data.roles[0].games} partie(s)` : undefined} />
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="card">
              <SectionHeader icon="rank" title="Champions" sub="Sur ses dernières parties" />
              <ul className="space-y-2" data-testid="player-champions">
                {data.champions.map((c) => (
                  <li key={c.name} className="flex items-center gap-2.5 text-sm">
                    <ChampIcon version={v} file={icon(c.name)} name={c.name} size={32} />
                    <span className="min-w-0 flex-1 truncate font-medium">{findChampion(champs, c.name)?.name ?? c.name}</span>
                    <span className="text-xs text-muted">KDA {n1(c.kda)}</span>
                    <Winrate wr={c.winrate} games={c.games} />
                  </li>
                ))}
              </ul>
              {data.masteries.length > 0 && (
                <>
                  <p className="label mt-4">Plus grande maîtrise</p>
                  <ul className="space-y-1 text-xs text-muted">
                    {data.masteries.map((m) => <li key={m.championId}>{m.champion} · niveau {m.level} · {m.points.toLocaleString("fr-FR")} pts</li>)}
                  </ul>
                </>
              )}
            </section>

            <section className="card lg:col-span-2">
              <SectionHeader icon="stats" title={data.page ? `Parties ${data.page * 20 + 1} à ${data.page * 20 + data.games.length}` : "Dernières parties"} sub="Résumé et champions calculés sur ces parties" />
              <ul className="space-y-1.5" data-testid="player-games">
                {data.games.map((g) => (
                  <li key={g.matchId} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${g.win ? "bg-win/[0.05] shadow-[inset_3px_0_0_#34d399]" : "bg-loss/[0.05] shadow-[inset_3px_0_0_#f87171]"}`}>
                    <ChampIcon version={v} file={icon(g.championName)} name={g.championName} size={34} />
                    <span className={`w-14 font-display font-bold ${g.win ? "text-win" : "text-loss"}`}>{g.win ? "Victoire" : "Défaite"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="tabular-nums font-medium">{g.kills}/{g.deaths}/{g.assists}</span>
                      <span className="ml-2 text-xs text-muted">{g.cs ?? "—"} sbires · {fmtDur(g.durationSec)}{g.kp != null ? ` · ${g.kp} % de participation` : ""}{g.opponent ? ` · contre ${findChampion(champs, g.opponent)?.name ?? g.opponent}` : ""}</span>
                    </span>
                    <span className="hidden text-xs text-muted sm:inline">{new Date(g.date as string).toLocaleDateString("fr-FR")}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
                {data.page > 0 ? <Link className="btn-ghost" href={`/app/players?q=${encodeURIComponent(`${data.account.gameName}#${data.account.tagLine}`)}&platform=${data.account.platform}&page=${data.page - 1}`}>← Plus récentes</Link> : <span />}
                {data.hasMore && <Link className="btn-ghost" href={`/app/players?q=${encodeURIComponent(`${data.account.gameName}#${data.account.tagLine}`)}&platform=${data.account.platform}&page=${data.page + 1}`} data-testid="older-games">Parties plus anciennes →</Link>}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
