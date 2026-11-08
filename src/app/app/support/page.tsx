import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";

export const metadata = { title: "Support" };

export default async function SupportPage() {
  await requirePageUser();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Aide et support" />
      <section className="card space-y-2 text-sm">
        <h2 className="h2">Questions fréquentes</h2>
        <p><strong>Ma vidéo reste « en attente de traitement ».</strong> Le worker doit tourner sur le serveur (<code>npm run worker</code>). Vous pouvez relancer un traitement échoué depuis la page de la vidéo.</p>
        <p><strong>Mon envoi a été interrompu.</strong> Ouvrez la bibliothèque : l&apos;envoi affiche « reprendre » ; sélectionnez le même fichier pour continuer là où il s&apos;est arrêté.</p>
        <p><strong>Pourquoi ma note est marquée « fiabilité faible » ?</strong> Données manquantes, partie courte ou rôle inconnu. Le rapport de match détaille la raison et les données absentes.</p>
        <p><strong>Mes amis voient-ils mes vidéos ?</strong> Non, sauf si vous partagez explicitement une vidéo avec un groupe, depuis sa page.</p>
        <p><strong>Un diagnostic me semble faux.</strong> Utilisez « Signaler un diagnostic incorrect » sous le moment concerné : il est marqué « contesté » et visible par l&apos;administration.</p>
      </section>
      <section className="card space-y-2 text-sm">
        <h2 className="h2">Vos données</h2>
        <p>Export, suppression et réglages de confidentialité : <Link className="underline" href="/app/settings#confidentialite">Paramètres</Link>.</p>
      </section>
    </div>
  );
}
