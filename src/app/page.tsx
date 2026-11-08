import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { Logo } from "@/components/Logo";

const pillars = [
  {
    title: "Vidéo et corrections animées",
    text: "Importez l'enregistrement d'une partie. Le lecteur de coaching ralentit, met en pause au moment de la décision, trace la trajectoire réelle et l'alternative proposée.",
    status: "Opérationnel — annotations manuelles",
  },
  {
    title: "Statistiques et note expliquée",
    text: "Une note sur 10 calculée par une formule versionnée, comparée d'abord à votre propre historique, avec les facteurs positifs, négatifs et les données manquantes.",
    status: "Opérationnel — saisie manuelle ; import Riot si une clé API est configurée",
  },
  {
    title: "Groupes entre amis",
    text: "Créez un groupe, invitez vos amis, comparez vos notes sur les parties communes et désignez le MVP du groupe — égalités comprises.",
    status: "Opérationnel",
  },
];

export default async function Home() {
  const user = await getCurrentUser();
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="flex items-center justify-between">
        <Logo />
        <nav className="flex gap-2">
          {user ? (
            <Link className="btn-primary" href="/app">Ouvrir CoachGG</Link>
          ) : (
            <>
              <Link className="btn-ghost" href="/login">Connexion</Link>
              <Link className="btn-primary" href="/register">Créer un compte</Link>
            </>
          )}
        </nav>
      </header>

      <section className="py-16 md:py-24">
        <p className="text-sm font-medium uppercase tracking-widest text-accent-2">League of Legends · coaching après match</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight md:text-5xl">
          Joue ta partie. CoachGG analyse ta vidéo et tes statistiques, et t&apos;aide à progresser.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Revois tes décisions image par image, compare-toi à ton propre historique et progresse avec tes amis.
          Uniquement après le match : aucun conseil en partie, aucune lecture mémoire, aucun contournement de protection.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="btn-primary px-5 py-2.5 text-base" href={user ? "/app" : "/register"}>Commencer</Link>
          <a className="btn-ghost px-5 py-2.5 text-base" href="#etat">État des fonctionnalités</a>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {pillars.map((p) => (
          <article key={p.title} className="card">
            <h2 className="h2">{p.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{p.text}</p>
            <p className="mt-4 text-xs text-accent-2">{p.status}</p>
          </article>
        ))}
      </section>

      <section id="etat" className="card mt-10">
        <h2 className="h2">Ce qui fonctionne aujourd&apos;hui — en toute transparence</h2>
        <ul className="mt-4 grid gap-2 text-sm md:grid-cols-2">
          <li>✅ Import réel de vidéo (reprise après coupure), traitement FFmpeg, lecture</li>
          <li>✅ Moments de coaching et annotations animées horodatées (création manuelle)</li>
          <li>✅ Comptes, profil, identité Riot déclarée</li>
          <li>✅ Note de performance versionnée et expliquée</li>
          <li>✅ Groupes, invitations, MVP entre amis</li>
          <li>🧪 Import Riot (Match-V5) : nécessite une clé API côté serveur</li>
          <li>🧪 Analyse vidéo assistée : propositions automatiques à valider (expérimental)</li>
          <li>🧪 Application PC : enregistrement automatique (agent expérimental, capture Windows à valider)</li>
        </ul>
        <p className="mt-4 text-xs text-muted">
          CoachGG n&apos;est ni approuvé ni sponsorisé par Riot Games. League of Legends est une marque de Riot Games, Inc.
        </p>
      </section>
    </main>
  );
}
