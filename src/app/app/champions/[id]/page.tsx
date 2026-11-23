/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, ProgressBar, SectionHeader, StatTile } from "@/components/ui";
import { ChampIcon, ItemIcon, Winrate } from "@/components/explore/Bits";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { ddChampionDetail, ddChampions, ddItems, ddRunes, ddText, ddVersion, findChampion, img, isFinishedItem, normChamp } from "@/server/riot/ddragon";
import { friendIds, userGames } from "@/server/riot/explorer";
import { buildStats, byOpponent, sampleNote, summarize } from "@/lib/riot/insights";

const n1 = (x: number | null) => (x == null ? "—" : String(x).replace(".", ","));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id };
}

export default async function ChampionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const [v, champs] = await Promise.all([ddVersion().catch(() => null), ddChampions().catch(() => null)]);
  if (!v || !champs) return <EmptyState icon="rank" title="Données du jeu indisponibles" text="Impossible de joindre le serveur de données de Riot pour l'instant." />;
  const base = champs.find((c) => c.id === id);
  if (!base) notFound();
  const [c, items, runes, friends] = await Promise.all([ddChampionDetail(id), ddItems().catch(() => ({} as Awaited<ReturnType<typeof ddItems>>)), ddRunes().catch(() => []), friendIds(user.id)]);
  const isThis = (name: string) => normChamp(name) === normChamp(c.id) || normChamp(name) === normChamp(c.name);
  const all = await userGames([user.id, ...friends]);
  const mine = all.filter((g) => g.userId === user.id && isThis(g.championName));
  const theirs = all.filter((g) => g.userId !== user.id && isThis(g.championName));
  const s = summarize(mine);
  const builds = buildStats(mine, (it) => isFinishedItem(items[String(it)]));
  const matchups = byOpponent(mine, 1);
  const keystone = new Map(runes.flatMap((t) => t.slots[0]?.runes ?? []).map((r) => [r.id, r]));
  const friendUsers = theirs.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(theirs.map((g) => g.userId))] } }, select: { id: true, displayName: true } }) : [];
  const keys = ["Q", "W", "E", "R"];

  return (
    <div className="space-y-6">
      <Link href="/app/champions" className="text-sm text-accent-2 hover:underline">← Tous les champions</Link>
      <section className="card-glow flex flex-wrap items-center gap-5">
        <ChampIcon version={v} file={c.image.full} name={c.name} size={88} />
        <div className="min-w-0 flex-1">
          <PageHeader eyebrow={c.tags.join(" · ")} title={c.name} subtitle={c.title} />
          <div className="-mt-4 grid max-w-md grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted">
            {([["Attaque", c.info.attack], ["Défense", c.info.defense], ["Magie", c.info.magic], ["Difficulté", c.info.difficulty]] as const).map(([l, x]) => (
              <div key={l}><span>{l}</span><ProgressBar value={x * 10} label={`${l} ${x} sur 10`} /></div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <SectionHeader icon="bolt" title="Sorts" sub={`Description officielle de Riot · version ${v}`} />
        <ul className="grid gap-3 md:grid-cols-2" data-testid="champion-spells">
          <li className="flex gap-3">
            <img src={img.passive(v, c.passive.image.full)} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-lg border border-line" loading="lazy" />
            <div><p className="font-medium"><span className="text-xs text-accent-2">Passif · </span>{c.passive.name}</p><p className="mt-0.5 whitespace-pre-line text-xs text-muted">{ddText(c.passive.description)}</p></div>
          </li>
          {c.spells.map((sp, i) => (
            <li key={sp.id} className="flex gap-3">
              <img src={img.spell(v, sp.image.full)} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-lg border border-line" loading="lazy" />
              <div>
                <p className="font-medium"><span className="font-display text-accent-2">{keys[i]} · </span>{sp.name}</p>
                {sp.cooldownBurn && <p className="text-[11px] text-cyan">Récupération : {sp.cooldownBurn} s</p>}
                <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{ddText(sp.description)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="h2">Toi sur {c.name}</h2>
        {mine.length === 0 ? (
          <EmptyState icon="stats" title={`Aucune partie sur ${c.name}`} text="Tes statistiques, tes builds et tes matchups s'afficheront ici dès que tu auras joué ce champion (import Riot ou saisie)." />
        ) : (
          <>
            <p className="text-xs text-muted">{sampleNote(mine.length)} Données de tes parties uniquement.</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile icon="trophy" label="Victoires" value={s.winrate == null ? "—" : `${s.winrate} %`} tone={(s.winrate ?? 0) >= 50 ? "win" : "loss"} hint={`${s.wins}V / ${s.games - s.wins}D`} />
              <StatTile icon="sword" label="KDA" value={n1(s.kda)} tone="accent" hint={`${n1(s.killsAvg)} / ${n1(s.deathsAvg)} / ${n1(s.assistsAvg)}`} />
              <StatTile icon="coin" label="Sbires / min" value={n1(s.csMin)} />
              <StatTile icon="stats" label="Parties" value={s.games} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <section className="card lg:col-span-2">
                <SectionHeader icon="coin" title="Tes objets" sub="Objets finis de tes parties, avec ton taux de victoire quand tu les achètes" />
                {builds.items.length ? (
                  <ul className="grid gap-2 sm:grid-cols-2" data-testid="champion-builds">
                    {builds.items.slice(0, 8).map((b) => (
                      <li key={b.id} className="flex items-center gap-2.5 rounded-xl border border-line/60 bg-bg/40 px-2.5 py-1.5 text-sm">
                        <ItemIcon version={v} id={b.id} name={items[String(b.id)]?.name ?? `Objet ${b.id}`} />
                        <span className="min-w-0 flex-1 truncate">{items[String(b.id)]?.name ?? `Objet ${b.id}`}</span>
                        <Winrate wr={b.winrate} games={b.games} />
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">Objets inconnus pour ces parties (parties saisies à la main ou importées sans détail).</p>}
                {builds.keystones.length > 0 && (
                  <>
                    <p className="label mt-4">Rune clé</p>
                    <ul className="flex flex-wrap gap-2">
                      {builds.keystones.map((k) => (
                        <li key={k.id} className="flex items-center gap-2 rounded-xl border border-line/60 bg-bg/40 px-2.5 py-1.5 text-sm">
                          {keystone.get(k.id) && <img src={img.rune(keystone.get(k.id)!.icon)} alt="" width={26} height={26} loading="lazy" />}
                          {keystone.get(k.id)?.name ?? `Rune ${k.id}`} <Winrate wr={k.winrate} games={k.games} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
              <section className="card">
                <SectionHeader icon="sword" title="Tes matchups" sub="Adversaire direct sur ta voie" />
                {matchups.length ? (
                  <ul className="space-y-1.5" data-testid="champion-matchups">
                    {matchups.slice(0, 10).map((m) => {
                      const o = findChampion(champs, m.name);
                      return (
                        <li key={m.name} className="flex items-center gap-2 text-sm">
                          <ChampIcon version={v} file={o?.image.full} name={o?.name ?? m.name} size={28} />
                          <span className="min-w-0 flex-1 truncate">{o?.name ?? m.name}</span>
                          <Winrate wr={m.winrate} games={m.games} />
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-muted">Adversaires inconnus (rôles absents des parties).</p>}
              </section>
            </div>
          </>
        )}
      </section>

      {friendUsers.length > 0 && (
        <section className="card">
          <SectionHeader icon="friends" title={`Tes amis sur ${c.name}`} />
          <ul className="space-y-1.5 text-sm">
            {friendUsers.map((f) => {
              const fs = summarize(theirs.filter((g) => g.userId === f.id));
              return (
                <li key={f.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate font-medium">{f.displayName}</span>
                  <span className="text-xs text-muted">KDA {n1(fs.kda)}</span>
                  <Winrate wr={fs.winrate} games={fs.games} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(c.allytips.length > 0 || c.enemytips.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {c.allytips.length > 0 && (
            <section className="card">
              <SectionHeader icon="coach" title={`Jouer ${c.name}`} sub="Conseils officiels" />
              <ul className="space-y-1.5 text-sm">{c.allytips.map((t) => <li key={t} className="flex gap-2"><span aria-hidden className="text-win">▸</span>{ddText(t)}</li>)}</ul>
            </section>
          )}
          {c.enemytips.length > 0 && (
            <section className="card">
              <SectionHeader icon="target" title={`Jouer contre ${c.name}`} sub="Conseils officiels" />
              <ul className="space-y-1.5 text-sm">{c.enemytips.map((t) => <li key={t} className="flex gap-2"><span aria-hidden className="text-loss">▸</span>{ddText(t)}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
