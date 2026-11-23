import Link from "next/link";
import { EmptyState, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import { ChampIcon, ROLE_FR, Winrate } from "@/components/explore/Bits";
import { requirePageUser } from "@/server/auth/page";
import { ddChampions, ddVersion, findChampion } from "@/server/riot/ddragon";
import { userGames } from "@/server/riot/explorer";
import { byChampion, byOpponent, byRole, sampleNote, summarize } from "@/lib/riot/insights";

export const metadata = { title: "Stats avancées" };
const n1 = (x: number | null) => (x == null ? "—" : String(x).replace(".", ","));

export default async function InsightsPage() {
  const user = await requirePageUser();
  const [games, v, champs] = await Promise.all([userGames([user.id]), ddVersion().catch(() => null), ddChampions().catch(() => [])]);
  const s = summarize(games);
  const champions = byChampion(games);
  const roles = byRole(games);
  const opponents = byOpponent(games, 2);
  const hard = [...opponents].sort((a, b) => (a.winrate ?? 0) - (b.winrate ?? 0) || b.games - a.games).slice(0, 5);
  const easy = [...opponents].sort((a, b) => (b.winrate ?? 0) - (a.winrate ?? 0) || b.games - a.games).slice(0, 5);
  const champ = (name: string) => findChampion(champs, name);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Performance" title="Stats avancées" subtitle="Tes résultats par champion, par rôle et contre chaque adversaire de voie — calculés sur tes vraies parties." />
      {games.length === 0 ? (
        <EmptyState icon="stats" title="Aucune partie" text="Connecte ton compte Riot ou saisis des parties pour voir tes statistiques détaillées." action={{ href: "/app/matches", label: "Mes matchs" }} />
      ) : (
        <>
          <p className="text-xs text-muted">{sampleNote(games.length)} Un taux de victoire sur moins de 3 parties est affiché en gris : il ne veut encore rien dire.</p>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon="trophy" label="Victoires" value={s.winrate == null ? "—" : `${s.winrate} %`} tone={(s.winrate ?? 0) >= 50 ? "win" : "loss"} hint={`${s.wins}V / ${s.games - s.wins}D`} />
            <StatTile icon="sword" label="KDA" value={n1(s.kda)} tone="accent" hint={`${n1(s.killsAvg)} / ${n1(s.deathsAvg)} / ${n1(s.assistsAvg)}`} />
            <StatTile icon="coin" label="Sbires / min" value={n1(s.csMin)} />
            <StatTile icon="rank" label="Champions joués" value={champions.length} />
          </section>

          <section className="card">
            <SectionHeader icon="rank" title="Par champion" sub="Clique un champion pour tes objets, runes et matchups" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm" data-testid="insights-champions">
                <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted">
                  <tr><th className="py-2">Champion</th><th>Victoires</th><th>KDA</th><th>V / M / A</th><th>Sbires / min</th></tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {champions.map((c) => {
                    const d = champ(c.name);
                    return (
                      <tr key={c.name} className="hover:bg-accent/[0.05]">
                        <td className="py-2">
                          <Link href={d ? `/app/champions/${d.id}` : "/app/champions"} className="flex items-center gap-2.5 hover:text-accent-2">
                            <ChampIcon version={v} file={d?.image.full} name={d?.name ?? c.name} size={30} />
                            <span className="font-medium">{d?.name ?? c.name}</span>
                          </Link>
                        </td>
                        <td><Winrate wr={c.winrate} games={c.games} /></td>
                        <td className="font-display tabular-nums">{n1(c.kda)}</td>
                        <td className="tabular-nums text-muted">{n1(c.killsAvg)} / {n1(c.deathsAvg)} / {n1(c.assistsAvg)}</td>
                        <td className="tabular-nums">{n1(c.csMin)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="card">
              <SectionHeader icon="stats" title="Par rôle" />
              {roles.length ? (
                <ul className="space-y-2 text-sm">
                  {roles.map((r) => (
                    <li key={r.name} className="flex items-center justify-between gap-2"><span className="font-medium">{ROLE_FR[r.name] ?? r.name}</span><Winrate wr={r.winrate} games={r.games} /></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">Rôles inconnus.</p>}
            </section>
            {([["Tes adversaires les plus durs", hard, "skull"], ["Tes adversaires les plus faciles", easy, "trophy"]] as const).map(([title, list, icon]) => (
              <section key={title} className="card" data-testid={icon === "skull" ? "insights-hard" : "insights-easy"}>
                <SectionHeader icon={icon} title={title} sub="Adversaire direct, au moins 2 parties" />
                {list.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {list.map((o) => {
                      const d = champ(o.name);
                      return (
                        <li key={o.name} className="flex items-center gap-2">
                          <ChampIcon version={v} file={d?.image.full} name={d?.name ?? o.name} size={28} />
                          <span className="min-w-0 flex-1 truncate">{d?.name ?? o.name}</span>
                          <Winrate wr={o.winrate} games={o.games} />
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-muted">Pas encore assez de parties contre un même adversaire.</p>}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
