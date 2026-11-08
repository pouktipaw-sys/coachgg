import Link from "next/link";
import { IntegrationNotice, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";

export const metadata = { title: "Capture PC" };

export default async function CapturePage() {
  await requirePageUser();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Application PC de capture" subtitle="Enregistrement automatique des parties sur Windows." />
      <IntegrationNotice title="Pas encore disponible">
        L&apos;application PC n&apos;est pas encore livrée. Un site web ne peut pas enregistrer le jeu en arrière-plan : la capture
        nécessite une application installée. En attendant, enregistrez vos parties avec un outil de votre choix (OBS Studio,
        Xbox Game Bar…) puis <Link className="underline" href="/app/videos/upload">importez la vidéo</Link> : le reste du parcours est identique.
      </IntegrationNotice>
      <section className="card space-y-3 text-sm">
        <h2 className="h2">Ce que fera l&apos;application (conception retenue)</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Installation unique, configuration et test d&apos;enregistrement.</li>
          <li>Capture de la <strong>fenêtre du jeu uniquement</strong> via les API de capture d&apos;écran de Windows ; micro et webcam désactivés.</li>
          <li>Détection du début et de la fin de partie via les mécanismes officiellement documentés, <strong>sans lecture mémoire</strong> ni interaction avec Vanguard.</li>
          <li>Stockage temporaire local avec limite d&apos;espace disque et nettoyage automatique.</li>
          <li>Après la partie : découpage, puis envoi au même point d&apos;entrée que l&apos;import manuel (envoi par morceaux reprenable).</li>
          <li>Aucun conseil pendant la partie : CoachGG reste un outil d&apos;après-match.</li>
        </ul>
        <p className="text-xs text-muted">
          Les points techniques et les autorisations à valider avant développement sont détaillés dans <code>docs/DESKTOP.md</code>.
        </p>
      </section>
    </div>
  );
}
