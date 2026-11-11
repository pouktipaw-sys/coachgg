import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { MODE_LABELS, ROLE_LABELS, ScorePill, fmtDuration } from "@/components/stats";
import { requirePageUser } from "@/server/auth/page";
import { listUserMatches, parseMatchFilters } from "@/server/matches/queries";
import { prisma } from "@/server/db";
import { autoSyncIfDue } from "@/server/riot/import";
import { RiotSyncStatus } from "@/components/riot/RiotSyncStatus";

export const metadata = { title: "Matchs & statistiques" };

export default async function MatchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const f = parseMatchFilters(sp);
  // Riot ID associé + clé configurée : import complet la première fois, puis mise à jour incrémentale.
  await autoSyncIfDue(user.id).catch(() => null);
  const [identity, syncJob] = await Promise.all([
    prisma.gameIdentity.findFirst({ where: { userId: user.id, provider: "riot", isPrimary: true }, select: { gameName: true, tagLine: true } }),
    prisma.analysisJob.findUnique({ where: { idempotencyKey: `riot-sync:${user.id}` }, select: { status: true, progress: true, error: true, result: true } }),
  ]);
  const PER_PAGE = 50;
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const [fetched, teams] = await Promise.all([
    listUserMatches(user.id, f, PER_PAGE + 1, (page - 1) * PER_PAGE),
    prisma.team.findMany({ where: { memberships: { some: { userId: user.id } } }, select: { id: true, name: true } }),
  ]);
  const mate = f.mate ? await prisma.teammate.findFirst({ where: { id: f.mate, ownerId: user.id } }) : null;
  const mateLabel = mate ? mate.nickname ?? `${mate.gameName}#${mate.tagLine}` : null;
  const rows = fetched.slice(0, PER_PAGE);
  const hasMore = fetched.length > PER_PAGE;
  const filtered = Object.entries(sp).some(([k, v]) => k !== "page" && !!v);
  const pageHref = (n: number) => `/app/matches?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => !!v)) as Record<string, string>, page: String(n) })}`;

  return (
    <div>
      <PageHeader
        title="Matchs & statistiques"
        subtitle="Historique des parties enregistrées (saisie manuelle ou import Riot)."
        actions={<Link href="/app/matches/new" className="btn-primary">Ajouter un match</Link>}
      />
      {identity && syncJob !== null && (
        <RiotSyncStatus initial={JSON.parse(JSON.stringify(syncJob))} riotId={`${identity.gameName}#${identity.tagLine}`} />
      )}
      <form className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-7" aria-label="Filtres">
        <select name="period" defaultValue={f.period} className="input" aria-label="Période">
          <option value="all">Toute période</option>
          <option value="7d">7 jours</option>
          <option value="30d">30 jours</option>
          <option value="90d">90 jours</option>
        </select>
        <input name="champion" defaultValue={f.champion} placeholder="Champion" className="input" aria-label="Champion" />
        <select name="role" defaultValue={f.role ?? ""} className="input" aria-label="Rôle">
          <option value="">Tous rôles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="mode" defaultValue={f.mode ?? ""} className="input" aria-label="Mode">
          <option value="">Tous modes</option>
          {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="with" defaultValue={f.with ?? ""} className="input" aria-label="Seul ou entre amis">
          <option value="">Seul ou avec amis</option>
          <option value="solo">Sans membre de mes groupes</option>
          <option value="friends">Avec des amis</option>
        </select>
        <select name="team" defaultValue={f.team ?? ""} className="input" aria-label="Groupe">
          <option value="">Tous groupes</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {f.mate && <input type="hidden" name="mate" value={f.mate} />}
        <button className="btn-ghost">Filtrer</button>
      </form>
      {f.mate && (
        <p className="mb-3 text-sm">
          Parties avec <strong>{mateLabel ?? "ce coéquipier"}</strong> dans votre équipe. <Link className="underline" href="/app/matches">Tout l&apos;historique</Link>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "Aucun match ne correspond aux filtres" : "Aucun match enregistré"}
          text={filtered ? undefined : "Saisissez les statistiques d'une partie (écran de fin de partie) ou importez vos parties via l'API Riot si elle est configurée."}
          action={filtered ? { href: "/app/matches", label: "Réinitialiser les filtres" } : { href: "/app/matches/new", label: "Ajouter un match" }}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-panel text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Résultat</th>
                <th className="px-3 py-2">Champion</th>
                <th className="px-3 py-2">Rôle</th>
                <th className="px-3 py-2">K/D/A</th>
                <th className="px-3 py-2">CS</th>
                <th className="px-3 py-2">Durée</th>
                <th className="px-3 py-2" title="Note CoachGG (expérimentale)">Note</th>
                <th className="px-3 py-2">Amis</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-panel-2">
                  <td className="px-3 py-2">
                    <Link className="hover:underline" href={`/app/matches/${r.id}`}>{new Date(r.date).toLocaleDateString("fr-FR")}</Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={r.me.win ? "text-win" : "text-loss"}>{r.me.win ? "Victoire" : "Défaite"}</span>
                  </td>
                  <td className="px-3 py-2">{r.me.championName}</td>
                  <td className="px-3 py-2">{r.me.role ? ROLE_LABELS[r.me.role] : "—"}</td>
                  <td className="px-3 py-2 font-mono">{r.me.kills}/{r.me.deaths}/{r.me.assists}</td>
                  <td className="px-3 py-2 font-mono">{r.me.creepScore ?? "—"}</td>
                  <td className="px-3 py-2 font-mono">{fmtDuration(r.durationSec)}</td>
                  <td className="px-3 py-2"><ScorePill score={r.me.score} reliability={r.me.reliability} /></td>
                  <td className="px-3 py-2 text-xs text-muted">{r.friends.join(", ") || "—"}</td>
                  <td className="px-3 py-2">
                    {r.isDemo ? <Badge tone="warn">Démo</Badge> : <Badge>{r.source === "RIOT_API" ? "Riot" : "Saisie"}</Badge>}
                    {r.recordings > 0 && <span className="ml-1" title="Vidéo associée">▶</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(page > 1 || hasMore) && (
        <nav className="mt-3 flex items-center gap-3 text-sm" aria-label="Pages">
          {page > 1 && <Link className="btn-ghost" href={pageHref(page - 1)}>← Plus récents</Link>}
          <span className="text-muted">Page {page}</span>
          {hasMore && <Link className="btn-ghost" href={pageHref(page + 1)} data-testid="matches-next">Plus anciens →</Link>}
        </nav>
      )}
      <p className="mt-3 text-xs text-muted">* fiabilité faible (partie courte ou données partielles). La note est expérimentale (formule perf-1.0.0).</p>
    </div>
  );
}
