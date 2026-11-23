/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, ProgressBar, SectionHeader, StatTile } from "@/components/ui";
import { ChampIcon, ItemIcon, ROLE_FR, Winrate } from "@/components/explore/Bits";
import { championLeaders, metaBuild } from "@/server/meta";
import { parseRunePageKey } from "@/lib/riot/meta";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { ddChampionDetail, ddChampions, ddItems, ddRunes, ddSummonerSpells, ddText, ddVersion, findChampion, img, isFinishedItem, normChamp } from "@/server/riot/ddragon";
import { friendIds, userGames } from "@/server/riot/explorer";
import { buildStats, byOpponent, sampleNote, summarize } from "@/lib/riot/insights";

const n1 = (x: number | null) => (x == null ? "—" : String(x).replace(".", ","));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id };
}

export default async function ChampionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const sp = await searchParams;
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
  const mode = (["RANKED", "ARAM", "ARENA"] as const).find((m) => m === sp.mode) ?? "RANKED";
  const meta = await metaBuild(Number(base.key), mode === "RANKED" ? sp.role : "ANY", undefined, mode).catch(() => null);
  const [spells, leaders] = await Promise.all([ddSummonerSpells().catch(() => ({}) as Record<string, { name: string; image: string }>), championLeaders(Number(base.key), { take: 10 }).catch(() => [])]);
  const metaItems = meta ? meta.items.filter((i) => isFinishedItem(items[String(i.itemId)])).slice(0, 8) : [];
  const runeById = new Map(runes.flatMap((t) => [{ id: t.id, name: t.name, icon: t.icon }, ...t.slots.flatMap((sl) => sl.runes.map((r) => ({ id: r.id, name: r.name, icon: r.icon })))]).map((r) => [r.id, r]));

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

      {meta && (
        <section className="card-glow space-y-4" data-testid="champion-meta">
          <SectionHeader icon="flame" title={`Méta · ${mode === "RANKED" ? ROLE_FR[meta.role] ?? meta.role : mode}`} sub={`Patch ${meta.patch.split("@")[0]} · ${meta.games.toLocaleString("fr-FR")} parties classées collectées · ${String(meta.winrate).replace(".", ",")} % de victoires`} />
          <nav aria-label="Mode" className="flex flex-wrap gap-1.5 text-xs">
            {([["RANKED", "Classée"], ["ARAM", "ARAM"], ["ARENA", "Arena"]] as const).map(([k, l]) => (
              <Link key={k} href={`/app/champions/${c.id}?mode=${k}`} className={`rounded-full border px-3 py-1 ${mode === k ? "border-magenta bg-magenta/20 text-white" : "border-line text-muted"}`}>{l}</Link>
            ))}
          </nav>
          {(meta.spells.length > 0 || meta.skills.length > 0 || meta.core.length > 0) && (
            <div className="grid gap-4 md:grid-cols-3" data-testid="champion-meta-choices">
              {meta.spells[0] && (
                <div>
                  <p className="label">Sorts d&apos;invocateur</p>
                  <div className="flex items-center gap-1.5">
                    {meta.spells[0].key.split(",").map((k) => (spells[k] ? <img key={k} src={img.spell(v, spells[k]!.image)} alt={spells[k]!.name} title={spells[k]!.name} width={34} height={34} className="rounded-lg border border-line" loading="lazy" /> : <span key={k} className="badge border-line text-muted">{k}</span>))}
                    <span className="ml-1 text-xs text-muted">{meta.spells[0].key.split(",").map((k) => spells[k]?.name ?? k).join(" + ")} · {meta.spells[0].pickrate} %</span>
                  </div>
                </div>
              )}
              {meta.skills[0] && (
                <div>
                  <p className="label">Ordre de montée des sorts</p>
                  <p className="flex items-center gap-1.5 font-display text-lg font-bold">
                    {meta.skills[0].key.split(">").map((k, i) => (
                      <span key={k} className="flex items-center gap-1.5">{i > 0 && <span className="text-muted">›</span>}<span className="grid h-8 w-8 place-items-center rounded-lg border border-accent/50 bg-accent/15 text-accent-2">{k}</span></span>
                    ))}
                  </p>
                  <p className="text-xs text-muted">Sort monté en premier à gauche · {meta.skills[0].pickrate} % des parties · R dès que possible</p>
                </div>
              )}
              {meta.core[0] && (
                <div>
                  <p className="label">Ordre des objets (3 premiers)</p>
                  <div className="flex items-center gap-1">
                    {meta.core[0].key.split(">").map((id, i) => (
                      <span key={id} className="flex items-center gap-1">{i > 0 && <span className="text-muted">›</span>}<ItemIcon version={v} id={Number(id)} name={items[id]?.name ?? `Objet ${id}`} size={34} /></span>
                    ))}
                  </div>
                  <p className="text-xs text-muted">{meta.core[0].key.split(">").map((id) => items[id]?.name ?? id).join(" › ")} · {String(meta.core[0].winrate).replace(".", ",")} % de victoires</p>
                </div>
              )}
            </div>
          )}
          {meta.roles.length > 1 && (
            <nav aria-label="Rôle" className="flex flex-wrap gap-1.5 text-xs">
              {meta.roles.map((r) => (
                <Link key={r.role} href={`/app/champions/${c.id}?role=${r.role}`} className={`rounded-full border px-3 py-1 ${r.role === meta.role ? "border-accent bg-accent/20 text-white" : "border-line text-muted"}`}>{ROLE_FR[r.role] ?? r.role} ({r.games})</Link>
              ))}
            </nav>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="label">Objets les plus construits</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {metaItems.map((b) => (
                  <li key={b.itemId} className="flex items-center gap-2 rounded-xl border border-line/60 bg-bg/40 px-2 py-1.5 text-xs">
                    <ItemIcon version={v} id={b.itemId} name={items[String(b.itemId)]?.name ?? `Objet ${b.itemId}`} size={26} />
                    <span className="min-w-0 flex-1 truncate">{items[String(b.itemId)]?.name ?? `Objet ${b.itemId}`}</span>
                    <span className="text-muted">{b.pickrate} %</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="label">Page de runes la plus jouée</p>
              {meta.runes[0] ? (() => {
                const page = parseRunePageKey(meta.runes[0]!.pageKey);
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {page.selectedPerkIds.slice(0, 6).map((pid, i) => {
                        const r = runeById.get(pid);
                        return r ? <img key={i} src={img.rune(r.icon)} alt={r.name} title={r.name} width={i === 0 ? 40 : 28} height={i === 0 ? 40 : 28} className={i === 0 ? "rounded-full ring-2 ring-gold/70" : "rounded-full"} loading="lazy" /> : <span key={i} className="badge border-line text-muted">{pid}</span>;
                      })}
                    </div>
                    <p className="text-xs text-muted">{runeById.get(page.primaryStyleId)?.name ?? ""} + {runeById.get(page.subStyleId)?.name ?? ""} · choisie dans {meta.runes[0]!.pickrate} % des parties · {String(meta.runes[0]!.winrate).replace(".", ",")} % de victoires</p>
                    <p className="text-[11px] text-muted">L&apos;application PC CoachGG peut l&apos;importer dans le client pendant la sélection des champions.</p>
                  </div>
                );
              })() : <p className="text-sm text-muted">Pas assez de données.</p>}
            </div>
          </div>
          {(meta.strongAgainst.length > 0 || meta.weakAgainst.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {([["Fort contre", meta.strongAgainst], ["Faible contre", meta.weakAgainst]] as const).map(([t, list]) => (
                <div key={t}>
                  <p className="label">{t}</p>
                  <ul className="space-y-1 text-sm">
                    {list.map((m) => {
                      const o = findChampion(champs, m.opponentId);
                      return <li key={m.opponentId} className="flex items-center gap-2"><ChampIcon version={v} file={o?.image.full} name={o?.name ?? `#${m.opponentId}`} size={24} /><span className="flex-1">{o?.name ?? `#${m.opponentId}`}</span><Winrate wr={Math.round(m.winrate)} games={m.games} /></li>;
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {leaders.length > 0 && (
        <section className="card" data-testid="champion-leaders">
          <SectionHeader icon="trophy" title={`Meilleurs joueurs de ${c.name}`} sub="Parties classées collectées · au moins 5 parties · classement ajusté au nombre de parties" />
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {leaders.map((l, i) => (
              <li key={l.puuid} className="flex items-center gap-2.5 rounded-xl border border-line/60 bg-bg/40 px-3 py-1.5 text-sm">
                <span className={`w-5 font-display font-bold ${i < 3 ? "text-gold" : "text-muted"}`}>{i + 1}</span>
                <Link className="min-w-0 flex-1 truncate font-medium hover:text-accent-2" href={l.riotId ? `/app/players?q=${encodeURIComponent(l.riotId)}&platform=${l.platform}` : `/app/players?puuid=${encodeURIComponent(l.puuid)}&platform=${l.platform}`}>{l.riotId ?? "Joueur"}</Link>
                <span className="text-[11px] text-muted">{l.platform}</span>
                <Winrate wr={Math.round(l.winrate)} games={l.games} />
              </li>
            ))}
          </ol>
        </section>
      )}

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
