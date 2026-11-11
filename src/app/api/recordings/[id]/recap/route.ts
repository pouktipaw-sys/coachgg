// Vidéo récap d'une partie : réservée au propriétaire (elle contient des propositions non validées).
import { authed, json } from "@/server/http";
import { prisma } from "@/server/db";
import { HttpError, notFound } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { requireRecordingOwner } from "@/server/permissions";
import { requestRecap } from "@/server/recap";
import { serveVideo } from "@/server/storage/serve";

type P = { id: string };

export const GET = authed<P>(async (req, user, { id }) => {
  await requireRecordingOwner(user.id, id);
  const rec = await prisma.recording.findUnique({ where: { id }, select: { recapKey: true, recapStatus: true, title: true } });
  if (!rec?.recapKey || rec.recapStatus !== "READY") throw notFound("Récap");
  const download = new URL(req.url).searchParams.get("download") === "1";
  return serveVideo(req, rec.recapKey, download ? { downloadName: `coachgg-recap-${rec.title.slice(0, 50)}.mp4` } : {});
});

/** Relance le montage du récap (après avoir validé, corrigé ou ajouté des moments). */
export const POST = authed<P>(async (_req, user, { id }) => {
  await requireRecordingOwner(user.id, id);
  if (!rateLimit(`recap:${user.id}`, 20, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de montages lancés récemment.");
  const n = await prisma.recommendation.count({ where: { recordingId: id, status: { not: "REJECTED" } } });
  if (!n) throw new HttpError(400, "no_moments", "Aucun moment à monter : lance d'abord l'analyse ou ajoute un moment.");
  await requestRecap(id);
  return json({ ok: true }, 202);
});
