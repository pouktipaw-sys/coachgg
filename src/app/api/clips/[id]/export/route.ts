import { authed, json } from "@/server/http";
import { clipExportFile, requestClipExport } from "@/server/clips";
import { storage } from "@/server/storage";

type P = { id: string };

/** Lance le rendu de la vidéo annotée. */
export const POST = authed<P>(async (_req, user, { id }) => json({ clip: await requestClipExport(user.id, id) }, 202));

/** Téléchargement du MP4 annoté (accès vérifié à chaque requête). */
export const GET = authed<P>(async (_req, user, { id }) => {
  const c = await clipExportFile(user.id, id);
  const size = await storage().size(c.exportKey!);
  const name = c.title.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "clip";
  return new Response(storage().readStream(c.exportKey!), {
    headers: {
      "Content-Type": "video/mp4",
      ...(size != null ? { "Content-Length": String(size) } : {}),
      "Content-Disposition": `attachment; filename="coachgg-${encodeURIComponent(name)}.mp4"`,
      "Cache-Control": "private, no-store",
    },
  });
});
