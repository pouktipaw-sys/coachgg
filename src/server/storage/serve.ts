// Envoi d'un fichier vidéo stocké, avec prise en charge des requêtes Range (déplacement dans la lecture).
import { HttpError, notFound } from "../errors";
import { storage } from "./index";

const MAX_RANGE = 8 * 1024 * 1024;

export async function serveVideo(req: Request, key: string, opts: { downloadName?: string } = {}) {
  const st = storage();
  const size = await st.size(key);
  if (size == null) throw notFound("Fichier vidéo");
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Content-Disposition": opts.downloadName ? `attachment; filename="${encodeURIComponent(opts.downloadName)}"` : "inline",
  };
  const range = req.headers.get("range");
  if (!range) return new Response(st.readStream(key), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  const m = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) throw new HttpError(416, "bad_range", "Plage invalide.");
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : Math.min(start + MAX_RANGE - 1, size - 1);
  }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(st.readStream(key, { start, end }), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
