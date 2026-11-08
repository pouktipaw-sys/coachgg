import Link from "next/link";
import { IdentityForm, ProfileForm } from "@/components/settings/ProfileForm";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";

export const metadata = { title: "Bienvenue" };

export default async function OnboardingPage() {
  const user = await requirePageUser();
  const [profile, identity] = await Promise.all([
    prisma.playerProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } }),
    prisma.gameIdentity.findFirst({ where: { userId: user.id } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Bienvenue sur CoachGG" subtitle="Trois étapes pour un coaching adapté. Tout est modifiable plus tard." />
      <section className="card space-y-3">
        <h2 className="h2">1 · Votre Riot ID (facultatif)</h2>
        {identity ? <p className="text-sm">Associé : {identity.gameName}#{identity.tagLine}</p> : <IdentityForm />}
        <p className="text-xs text-muted">Jamais de mot de passe Riot. Le Riot ID permet de relier vos parties et vos amis.</p>
      </section>
      <section className="card space-y-3">
        <h2 className="h2">2 · Votre profil</h2>
        <ProfileForm displayName={user.displayName} profile={profile} onboarding />
      </section>
      <section className="card space-y-2 text-sm">
        <h2 className="h2">3 · Ensuite</h2>
        <p>
          <Link className="underline" href="/app/videos/upload">Importez une vidéo</Link> de partie pour créer vos moments de coaching,{" "}
          <Link className="underline" href="/app/matches/new">ajoutez un match</Link> pour obtenir votre note, et{" "}
          <Link className="underline" href="/app/teams">créez un groupe</Link> avec vos amis.
        </p>
      </section>
    </div>
  );
}
