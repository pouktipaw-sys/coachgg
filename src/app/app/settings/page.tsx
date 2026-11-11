import { ActionButton } from "@/components/ActionButton";
import { DeleteAccountForm, IdentityForm, ProfileForm } from "@/components/settings/ProfileForm";
import { Badge, IntegrationNotice, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { formatRank, type RankEntry } from "@/components/stats";
import { integrationStatus } from "@/lib/env";

export const metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const user = await requirePageUser();
  const [profile, identities] = await Promise.all([
    prisma.playerProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } }),
    prisma.gameIdentity.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const riot = integrationStatus().riotApi === "configured";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Paramètres" subtitle={user.email} />

      <section className="card space-y-3" id="identite">
        <h2 className="h2">Comptes Riot</h2>
        <p className="text-sm text-muted">
          CoachGG ne demande jamais votre mot de passe Riot. Le Riot ID est <strong>déclaré</strong> : il sert à retrouver vos
          parties publiques et à reconnaître vos amis dans un match. La vérification officielle (Riot Sign On) nécessite une
          application approuvée par Riot et n&apos;est pas encore disponible.
        </p>
        {identities.length > 0 && (
          <ul className="space-y-1 text-sm">
            {identities.map((i) => (
              <li key={i.id} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2">
                <span>
                  {i.gameName}#{i.tagLine} · {i.platform} {i.isPrimary && <Badge tone="info">Principale</Badge>}{" "}
                  <Badge tone={i.verification === "VERIFIED_RSO" ? "ok" : "warn"}>{i.verification === "VERIFIED_RSO" ? "Vérifiée" : "Déclarée, non vérifiée"}</Badge>
                  <span className="block text-xs text-muted">
                    {Array.isArray(i.rank) && (i.rank as RankEntry[]).length
                      ? (i.rank as RankEntry[]).map(formatRank).join(" · ")
                      : i.rankFetchedAt ? "Aucune partie classée cette saison" : "Rang non récupéré"}
                    {i.rankFetchedAt && ` (mis à jour le ${i.rankFetchedAt.toLocaleDateString("fr-FR")})`}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  {!i.isPrimary && <ActionButton url={`/api/identities/${i.id}`} method="PATCH" label="Définir comme principal" className="text-xs underline" />}
                  {riot && <ActionButton url={`/api/identities/${i.id}/rank`} label="Actualiser le rang" className="text-xs underline" />}
                  <ActionButton url={`/api/identities/${i.id}`} method="DELETE" label="Retirer" className="text-xs text-loss underline" />
                </span>
              </li>
            ))}
          </ul>
        )}
        <IdentityForm />
        <p className="text-xs text-muted">
          Vous pouvez associer plusieurs comptes (smurf, autre serveur…) : toutes leurs parties rejoignent votre historique, et le compte principal est celui affiché à vos amis.
        </p>
      </section>

      <section className="card space-y-3">
        <h2 className="h2">Profil et préférences</h2>
        <ProfileForm displayName={user.displayName} profile={profile} />
      </section>

      <section className="card space-y-3" id="confidentialite">
        <h2 className="h2">Confidentialité</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Vos vidéos sont privées par défaut. Le partage se fait vidéo par vidéo, vers un groupe choisi, et peut être retiré à tout moment.</li>
          <li>Les membres d&apos;un groupe voient les notes des parties communes ; les statistiques détaillées selon votre réglage ci-dessus.</li>
          <li>Microphone et webcam ne sont jamais utilisés. Aucune donnée n&apos;est lue dans la mémoire du jeu.</li>
          <li>Les fichiers vidéo sont stockés sur le serveur de cette instance, servis uniquement après vérification de vos droits.</li>
          <li>Si vous choisissez une durée de conservation, le worker supprime automatiquement (chaque heure) les vidéos plus anciennes, avec leurs moments et annotations.</li>
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="h2">Vos données</h2>
        <a className="btn-ghost" href="/api/account/export">Exporter mes données (JSON)</a>
        <div className="border-t border-line pt-3">
          <h3 className="mb-2 font-medium text-loss">Supprimer le compte</h3>
          <p className="mb-2 text-xs text-muted">Suppression définitive : vidéos, moments, annotations, statistiques, notes et appartenances aux groupes.</p>
          <DeleteAccountForm />
        </div>
      </section>

      <IntegrationNotice title="Email">
        L&apos;envoi d&apos;emails n&apos;est pas configuré dans cette version : les invitations sont des notifications internes et le lien de
        réinitialisation n&apos;apparaît que dans les logs serveur en développement.
      </IntegrationNotice>
    </div>
  );
}
