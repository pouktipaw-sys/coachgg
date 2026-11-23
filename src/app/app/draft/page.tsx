import Link from "next/link";
import { PageHeader, SectionHeader } from "@/components/ui";
import { ChampIcon, ROLE_FR, Winrate } from "@/components/explore/Bits";
import { ChampionInput, ChampionMultiInput } from "@/components/ChampionInput";
import { MetaEmpty } from "@/components/explore/MetaEmpty";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { ddChampions, ddVersion, findChampion } from "@/server/riot/ddragon";
import { draftAdvice } from "@/server/meta";

export const metadata = { title: "Aide à la sélection" };
export const dynamic = "force-dynamic";
const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;

export default async function DraftPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const profile = await prisma.playerProfile.findUnique({ where: { userId: user.id }, select: { primaryRole: true } });
  const role = ROLES.includes(sp.role as (typeof ROLES)[number]) ? sp.role! : profile?.primaryRole ?? "MIDDLE";
  const [v, champs] = await Promise.all([ddVersion().catch(() => null), ddChampions().catch(() => [])]);
  const enemy = sp.enemy ? findChampion(champs, sp.enemy) : undefined;
  const takenNames = (sp.taken ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const taken = takenNames.map((n) => findChampion(champs, n)).filter((c): c is NonNullable<typeof c> => !!c);
  const advice = await draftAdvice({ role, enemyLaner: enemy ? Number(enemy.key) : null, taken: [...taken.map((c) => Number(c.key)), ...(enemy ? [Number(enemy.key)] : [])] });
  const ch = (id: number) => findChampion(champs, id);
  const Row = ({ id, right }: { id: number; right: React.ReactNode }) => {
    const c = ch(id);
    return (
      <li className="flex items-center gap-2.5 text-sm">
        <ChampIcon version={v} file={c?.image.full} name={c?.name ?? `#${id}`} size={32} />
        <Link href={c ? `/app/champions/${c.id}?role=${role}` : "#"} className="min-w-0 flex-1 truncate font-medium hover:text-accent-2">{c?.name ?? `#${id}`}</Link>
        {right}
      </li>
    );
  };
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Explorer" title="Aide à la sélection" subtitle="Quel champion prendre, contre qui, et quoi bannir — d'après les parties classées collectées." />
      <form className="card-glow grid gap-3 md:grid-cols-[auto_1fr_2fr_auto] md:items-end" aria-label="Sélection en cours">
        <div>
          <label className="label" htmlFor="d-role">Ton rôle</label>
          <select id="d-role" name="role" defaultValue={role} className="input">{ROLES.map((r) => <option key={r} value={r}>{ROLE_FR[r]}</option>)}</select>
        </div>
        <div>
          <label className="label" htmlFor="d-enemy">Adversaire de voie (si connu)</label>
          <ChampionInput id="d-enemy" name="enemy" defaultValue={enemy?.name ?? ""} placeholder="ex. Zed" aria-label="Adversaire de voie" />
        </div>
        <div>
          <label className="label" htmlFor="d-taken">Champions déjà pris ou bannis</label>
          <ChampionMultiInput id="d-taken" name="taken" defaultValue={taken.map((c) => c.name)} max={9} />
        </div>
        <button className="btn-primary">Conseiller</button>
      </form>
      {!advice ? (
        <MetaEmpty />
      ) : (
        <>
          <p className="text-xs text-muted">Patch {advice.patch} · {advice.games.toLocaleString("fr-FR")} parties. Ce sont des tendances statistiques : le champion que tu maîtrises reste souvent le meilleur choix.</p>
          <div className="grid gap-4 lg:grid-cols-3" data-testid="draft-advice">
            <section className="card">
              <SectionHeader icon="sword" title={enemy ? `Contres de ${enemy.name}` : "Contres"} sub={enemy ? `Au ${ROLE_FR[role]}, au moins 8 parties face à lui` : "Indique l'adversaire de voie"} />
              {advice.counters.length ? <ul className="space-y-2">{advice.counters.map((x) => <Row key={x.championId} id={x.championId} right={<Winrate wr={Math.round(x.winrate)} games={x.games} />} />)}</ul> : <p className="text-sm text-muted">{enemy ? "Pas encore assez de parties face à ce champion." : "—"}</p>}
            </section>
            <section className="card">
              <SectionHeader icon="flame" title={`Les plus forts au ${ROLE_FR[role]}`} sub="Tier list du patch" />
              <ul className="space-y-2">{advice.best.map((x) => <Row key={x.championId} id={x.championId} right={<span className="text-xs text-muted"><span className="font-display text-accent-2">{x.tier}</span> · {String(x.winrate).replace(".", ",")} %</span>} />)}</ul>
            </section>
            <section className="card">
              <SectionHeader icon="skull" title="Bannissements conseillés" sub="Forts et très joués" />
              <ul className="space-y-2">{advice.bans.map((x) => <Row key={x.championId} id={x.championId} right={<span className="text-xs text-muted">{String(x.winrate).replace(".", ",")} % · ban {String(x.banrate).replace(".", ",")} %</span>} />)}</ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
