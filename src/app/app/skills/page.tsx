import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { skillsPlan } from "@/server/skills";
import { TIER_FR } from "@/lib/nextRank";

export const metadata = { title: "Rang suivant" };

export default async function SkillsPage() {
  const user = await requirePageUser();
  const s = await skillsPlan(user.id);
  const cur = s.current ? `${TIER_FR[s.currentTier!] ?? s.current.tier}${["MASTER", "GRANDMASTER", "CHALLENGER"].includes(s.current.tier) ? "" : ` ${s.current.division}`}` : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Objectif : ${TIER_FR[s.target]}`}
        subtitle={
          cur
            ? `Rang actuel (${s.riotId}) : ${cur} · ${s.current!.lp} PL. Voici ce qui te sépare du palier au-dessus, du plus urgent au moins urgent.`
            : "Rang inconnu (associe ton compte Riot dans les paramètres et actualise le rang) : objectif par défaut."
        }
      />
      {s.measured === 0 ? (
        <EmptyState title="Pas encore de partie notée" text="Importe ou saisis quelques parties : le plan se construit à partir de tes vraies statistiques." action={{ href: "/app/matches", label: "Mes matchs" }} />
      ) : (
        <ol className="space-y-4" data-testid="next-rank-plan">
          {s.items.map((it, i) => {
            const behind = it.gap != null && it.gap > 0;
            return (
              <li key={it.key} className={`card space-y-3 ${i === 0 && behind ? "border-warn/50" : ""}`} data-testid="plan-item">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="h2">{i + 1}. {it.title}</h2>
                    <p className="text-xs text-muted">{it.why}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p>
                      <span className="font-mono">{it.now ?? "—"}</span> <span className="text-muted">/ repère</span> <span className="font-mono">{it.target}</span>
                    </p>
                    <p className={`text-xs ${it.gap == null ? "text-muted" : behind ? "text-warn" : "text-win"}`}>
                      {it.gap == null ? "non mesuré" : behind ? `encore ${it.gap} point(s)` : "déjà au niveau ✓"}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="label">À faire en partie</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">{it.tips.map((t, k) => <li key={k}>{t}</li>)}</ul>
                  </div>
                  <div>
                    <p className="label">🖱️ À la souris et au clavier</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">{it.mouse.map((t, k) => <li key={k}>{t}</li>)}</ul>
                  </div>
                </div>
                <div>
                  <p className="label">🎬 Exemples en vidéo</p>
                  {it.examples.length ? (
                    <ul className="space-y-1 text-sm">
                      {it.examples.map((e) => (
                        <li key={e.id}>
                          <Link className="underline" href={e.href}>{e.good ? "✅ " : "✏️ "}{e.title}</Link>
                          <span className="text-xs text-muted"> · {e.mine ? "ta vidéo" : `partagée par ${e.owner}`}{e.hasClicks ? " · clics conseillés dessinés" : ""}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">
                      Pas encore d&apos;exemple : quand l&apos;analyse ou toi publiez un moment de cette catégorie (une bonne action ou une erreur avec l&apos;alternative dessinée), il apparaîtra ici. Tes amis peuvent aussi te partager les leurs.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-xs text-muted">
        Les repères par rang sont des estimations internes (Riot ne publie pas de moyennes par rang) : ils servent à ordonner tes priorités, pas à prédire ton rang.
        Ton profil est calculé sur tes 10 dernières parties notées. Voir aussi <Link className="underline" href="/app/progress">Progression</Link>.
      </p>
    </div>
  );
}
