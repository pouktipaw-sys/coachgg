import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { SectionHeader, StatTile } from "@/components/ui";
import { ChampIcon, RankBadge, ROLE_FR, Winrate } from "@/components/explore/Bits";
import { ddChampions, ddVersion, findChampion } from "@/server/riot/ddragon";
import { publicProfile } from "@/server/publicProfile";
import { sampleNote } from "@/lib/riot/insights";

// Profil public : visible sans compte, mais jamais indexé par les moteurs de recherche.
export const metadata = { title: "Profil joueur", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
const n1 = (x: number | null) => (x == null ? "—" : String(x).replace(".", ","));

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const p = await publicProfile((await params).slug);
  if (!p) notFound();
  const [v, champs] = await Promise.all([ddVersion().catch(() => null), ddChampions().catch(() => [])]);
  const ch = (n: string) => findChampion(champs, n);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <Logo />
        <Link href="/register" className="btn-primary">Crée ton profil CoachGG</Link>
      </header>
      <section className="card-glow" data-testid="public-profile">
        <p className="eyebrow">Profil joueur</p>
        <h1 className="mt-1 font-display text-3xl font-bold"><span className="text-gradient">{p.displayName}</span></h1>
        <p className="mt-1 text-sm text-muted">
          {p.riotId ? `${p.riotId} · ${p.platform}` : "Riot ID non associé"}
          {p.role ? ` · ${ROLE_FR[p.role] ?? p.role}` : ""}
        </p>
        <div className="mt-2 flex flex-col gap-0.5 text-sm">
          {p.ranks.length ? p.ranks.map((r) => <span key={r.queue}><span className="text-xs text-muted">{r.label} :</span> <RankBadge r={r} /></span>) : null}
        </div>
      </section>
      {p.summary.games === 0 ? (
        <p className="card text-sm text-muted">Pas encore de partie enregistrée.</p>
      ) : (
        <>
          <p className="text-xs text-muted">Sur les {p.summary.games} dernières parties enregistrées sur CoachGG. {sampleNote(p.summary.games)}</p>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon="trophy" label="Victoires" value={p.summary.winrate == null ? "—" : `${p.summary.winrate} %`} tone={(p.summary.winrate ?? 0) >= 50 ? "win" : "loss"} hint={`${p.summary.wins}V / ${p.summary.games - p.summary.wins}D`} />
            <StatTile icon="sword" label="KDA" value={n1(p.summary.kda)} tone="accent" />
            <StatTile icon="coin" label="Sbires / min" value={n1(p.summary.csMin)} />
            <StatTile icon="rank" label="Champion principal" value={p.champions[0] ? ch(p.champions[0].name)?.name ?? p.champions[0].name : "—"} />
          </section>
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="card">
              <SectionHeader icon="rank" title="Champions" />
              <ul className="space-y-2 text-sm">
                {p.champions.map((c) => (
                  <li key={c.name} className="flex items-center gap-2.5">
                    <ChampIcon version={v} file={ch(c.name)?.image.full} name={c.name} size={30} />
                    <span className="min-w-0 flex-1 truncate">{ch(c.name)?.name ?? c.name}</span>
                    <Winrate wr={c.winrate} games={c.games} />
                  </li>
                ))}
              </ul>
            </section>
            <section className="card lg:col-span-2">
              <SectionHeader icon="stats" title="Dernières parties" />
              <ul className="space-y-1.5 text-sm">
                {p.games.map((g, i) => (
                  <li key={i} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${g.win ? "bg-win/[0.05] shadow-[inset_3px_0_0_#34d399]" : "bg-loss/[0.05] shadow-[inset_3px_0_0_#f87171]"}`}>
                    <ChampIcon version={v} file={ch(g.championName)?.image.full} name={g.championName} size={30} />
                    <span className={`w-14 font-display font-bold ${g.win ? "text-win" : "text-loss"}`}>{g.win ? "Victoire" : "Défaite"}</span>
                    <span className="flex-1 tabular-nums">{g.kills}/{g.deaths}/{g.assists} <span className="text-xs text-muted">· {g.cs ?? "—"} sbires</span></span>
                    <span className="text-xs text-muted">{g.date ? new Date(g.date).toLocaleDateString("fr-FR") : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
      <p className="text-center text-xs text-muted">Profil rendu public par le joueur. Aucune vidéo ni donnée privée n&apos;est affichée.</p>
    </div>
  );
}
