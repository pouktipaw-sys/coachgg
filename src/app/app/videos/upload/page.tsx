import { Uploader } from "@/components/video/Uploader";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { userMatchOptions } from "@/server/matches/queries";

export const metadata = { title: "Importer une vidéo" };

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ resume?: string }> }) {
  const user = await requirePageUser();
  const { resume } = await searchParams;
  const resumeRec = resume
    ? await prisma.recording.findFirst({ where: { id: resume, ownerId: user.id, status: "UPLOADING" } })
    : null;
  const matches = await userMatchOptions(user.id);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Importer une vidéo"
        subtitle="Enregistrement d'une partie (OBS, outil Windows, export de replay…). L'envoi reprend automatiquement après une coupure."
      />
      <Uploader
        matches={matches}
        resume={resumeRec ? { id: resumeRec.id, filename: resumeRec.originalFilename, sizeBytes: Number(resumeRec.sizeBytes) } : null}
      />
      <p className="mt-4 text-xs text-muted">
        Conseils : capturez uniquement la fenêtre du jeu, sans micro ni webcam. Une résolution 1080p à 30 ou 60 i/s suffit.
        Les vidéos sont privées par défaut ; vous choisissez ensuite avec qui les partager.
      </p>
    </div>
  );
}
