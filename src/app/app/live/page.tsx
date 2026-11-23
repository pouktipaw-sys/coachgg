import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { ChampIcon, RankBadge } from "@/components/explore/Bits";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/errors";
import { PLATFORMS } from "@/server/riot/client";
import { ddVersion } from "@/server/riot/ddragon";
import { liveGame } from "@/server/riot/explorer";

export const metadata = { title: "Partie en cours" };
export const dynamic = "force-dynamic";

const MODES: Record<string, string> = { CLASSIC: "Faille de l'invocateur", ARAM: "ARAM", URF: "URF", CHERRY: "Arena" };
const QUEUES: Record<number, string> = { 420: "Classée solo/duo", 440: "Classée flexible", 400: "Normale (draft)", 430: "Normale", 490: "Normale (rapide)", 450: "ARAM" };

export default async function LivePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const ids = await prisma.gameIdentity.findMany({ where: { userId: user.id }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
  const q = sp.q?.trim() || (ids[0] ? `${ids[0].gameName}#${ids[0].tagLine}` : "");
  const platform = sp.platform ?? ids[0]?.platform ?? "EUW1";
  let data: Awaited<ReturnType<typeof liveGame>> | null = null;
  let error: string | null = null;
  if (q) {
    try {
      data = await liveGame(q, platform);
    } catch (e) {
      error = e instanceof HttpError ? e.message : "Partie en cours indisponible pour le moment.";
    }
  }
  const v = await ddVersion().catch(() => null);
  const min = data?.game ? Math.floor(data.game.lengthSec / 60) : 0;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Explorer" title="Partie en cours" subtitle="Les 10 joueurs d'une partie en direct : rang, taux de victoire classé et maîtrise du champion joué." />

      <form className="card-glow flex flex-wrap items-end gap-2" aria-label="Chercher une partie en cours">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="lq">Riot ID</label>
          <input id="lq" name="q" defaultValue={q} className="input" placeholder="Pseudo#TAG" required autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="lp">Serveur</label>
          <select id="lp" name="platform" defaultValue={platform} className="input">
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button className="btn-primary">Actualiser</button>
      </form>

      {error && <p role="alert" className="card border-loss/40 text-sm text-loss">{error}</p>}
      {!q && <EmptyState icon="target" title="Aucun Riot ID" text="Associe ton Riot ID dans les paramètres, ou tape celui d'un joueur." action={{ href: "/app/settings#identite", label: "Associer mon Riot ID" }} />}

      {data && !data.game && (
        <EmptyState icon="target" title={`${data.account.gameName}#${data.account.tagLine} n'est pas en partie`} text="Lance une partie puis reviens ici : les informations s'affichent dès l'écran de chargement." />
      )}

      {data?.game && (
        <>
          <p className="text-sm text-muted" data-testid="live-meta">
            <span className="font-display text-accent-2">{(data.game.queueId && QUEUES[data.game.queueId]) || MODES[data.game.mode] || data.game.mode}</span>
            {data.game.lengthSec > 0 ? ` · en cours depuis ${min} min` : " · écran de chargement"}
            {" · "}les données de rang et de maîtrise viennent de Riot (publiques).
          </p>
          <div className="grid gap-4 lg:grid-cols-2" data-testid="live-game">
            {data.game.teams.map((t) => (
              <section key={t.teamId} className={`card ${t.teamId === 100 ? "border-ally/40" : "border-loss/40"}`}>
                <h2 className={`h2 mb-3 ${t.teamId === 100 ? "text-ally" : "text-loss"}`}>Équipe {t.teamId === 100 ? "bleue" : "rouge"}</h2>
                <ul className="space-y-2">
                  {t.players.map((p, i) => (
                    <li key={i} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${p.isMe ? "border-gold/60 bg-gold/[0.07] shadow-[0_0_18px_-8px_#fbbf24]" : "border-line/60 bg-bg/40"}`} data-testid="live-player">
                      <ChampIcon version={v} file={p.championImage} name={p.champion} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {p.riotId ? (
                            <Link className="hover:text-accent-2" href={`/app/players?q=${encodeURIComponent(p.riotId)}&platform=${data!.account.platform}`}>{p.riotId}</Link>
                          ) : "Joueur masqué"}
                          {p.isMe && <span className="ml-1.5 text-xs text-gold">(recherché)</span>}
                        </p>
                        <p className="text-xs text-muted">{p.champion} · {p.spells.map((s) => s.name).join(" + ")}</p>
                      </div>
                      <div className="text-right text-xs">
                        <RankBadge r={p.rank} compact />
                        <p className="text-muted">{p.winrate != null ? `${p.winrate} % (${(p.rank?.wins ?? 0) + (p.rank?.losses ?? 0)})` : "—"}</p>
                        <p className="text-muted">{p.mastery ? `Maîtrise ${p.mastery.level} · ${Math.round(p.mastery.points / 1000)}k` : "Maîtrise inconnue"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {t.bans.length > 0 && <p className="mt-3 text-xs text-muted">Bannis : {t.bans.join(", ")}</p>}
              </section>
            ))}
          </div>
          <p className="text-xs text-muted">Aucune aide pendant la partie (minuteurs, positions ennemies) : uniquement des informations publiques visibles avant de jouer, conformément aux règles de Riot.</p>
        </>
      )}
    </div>
  );
}
