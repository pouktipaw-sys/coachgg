// Lecture vidéo avec prise en charge des requêtes Range (seek côté navigateur).
// Chaque requête vérifie la session et la permission : pas d'URL publique.
import { authed } from "@/server/http";
import { prisma } from "@/server/db";
import { HttpError, notFound } from "@/server/errors";
import { requireRecordingView } from "@/server/permissions";
import { storage } from "@/server/storage";

type P = { id: string };
const MAX_RANGE = 8 * 1024 * 1024;

export const GET = authed<P>(async (req, user, { id }) => {
  await requireRecordingView(user.id, id);
  const rec = await prisma.recording.findUnique({ where: { id }, select: { playbackKey: true, status: true } });
  if (!rec?.playbackKey || rec.status !== "READY") throw notFound("Vidéo prête");
  const st = storage();
  const size = await st.size(rec.playbackKey);
  if (size == null) throw notFound("Fichier vidéo");

  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Content-Disposition": "inline",
  };
  const range = req.headers.get("range");
  if (!range) {
    return new Response(st.readStream(rec.playbackKey), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  }
  const m = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) throw new HttpError(416, "bad_range", "Plage invalide.");
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : Math.min(start + MAX_RANGE - 1, size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(st.readStream(rec.playbackKey, { start, end }), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
});
