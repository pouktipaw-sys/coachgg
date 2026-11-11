// Lecture vidéo avec prise en charge des requêtes Range (seek côté navigateur).
// Chaque requête vérifie la session et la permission : pas d'URL publique.
import { authed } from "@/server/http";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { requireRecordingView } from "@/server/permissions";
import { serveVideo } from "@/server/storage/serve";

type P = { id: string };

export const GET = authed<P>(async (req, user, { id }) => {
  await requireRecordingView(user.id, id);
  const rec = await prisma.recording.findUnique({ where: { id }, select: { playbackKey: true, status: true } });
  if (!rec?.playbackKey || rec.status !== "READY") throw notFound("Vidéo prête");
  return serveVideo(req, rec.playbackKey);
});
