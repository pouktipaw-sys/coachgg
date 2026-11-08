import Link from "next/link";
import { ManualMatchForm } from "@/components/matches/ManualMatchForm";
import { RiotImport } from "@/components/matches/RiotImport";
import { IntegrationNotice, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { integrationStatus } from "@/lib/env";

export const metadata = { title: "Ajouter un match" };

export default async function NewMatchPage() {
  const user = await requirePageUser();
  const [identity, profile] = await Promise.all([
    prisma.gameIdentity.findFirst({ where: { userId: user.id, isPrimary: true } }),
    prisma.playerProfile.findUnique({ where: { userId: user.id } }),
  ]);
  const riot = integrationStatus().riotApi;
  return (
    <div className="space-y-6">
      <PageHeader title="Ajouter un match" actions={<Link href="/app/matches" className="btn-ghost">← Historique</Link>} />
      <section className="card space-y-3">
        <h2 className="h2">Import via l&apos;API Riot</h2>
        {riot === "configured" ? (
          identity ? (
            <>
              <p className="text-sm text-muted">
                Parties publiques de <strong>{identity.gameName}#{identity.tagLine}</strong> ({identity.platform}) via MATCH-V5.
                Identité déclarée, non vérifiée par Riot Sign On.
              </p>
              <RiotImport />
            </>
          ) : (
            <p className="text-sm">Ajoutez votre Riot ID dans <Link className="underline" href="/app/settings">Paramètres</Link> pour importer vos parties.</p>
          )
        ) : (
          <IntegrationNotice title="Intégration Riot non configurée">
            L&apos;import automatique nécessite une clé API Riot côté serveur (variable <code>RIOT_API_KEY</code>). Une clé de
            développement s&apos;obtient sur developer.riotgames.com (expire après 24 h) ; un service public nécessite une clé de
            production approuvée par Riot. En attendant, la saisie manuelle ci-dessous fonctionne entièrement.
          </IntegrationNotice>
        )}
      </section>
      <section>
        <h2 className="h2 mb-3">Saisie manuelle</h2>
        <ManualMatchForm identity={identity ? { gameName: identity.gameName, tagLine: identity.tagLine } : null} primaryRole={profile?.primaryRole ?? null} />
      </section>
    </div>
  );
}
