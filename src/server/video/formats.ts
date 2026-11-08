// Validation des formats vidéo acceptés (extension + signature binaire).
// La validation définitive est faite par ffprobe dans le worker.

export const ACCEPTED_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv"] as const;
export type AcceptedExt = (typeof ACCEPTED_EXTENSIONS)[number];

export function extensionOf(filename: string): AcceptedExt | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as AcceptedExt) : null;
}

const MIME_OK = /^(video\/(mp4|quicktime|webm|x-matroska|x-m4v|matroska)|application\/octet-stream|)$/i;
export function mimeAcceptable(mime: string) {
  return MIME_OK.test(mime.trim());
}

/** Vérifie la signature des premiers octets selon la famille de conteneur. */
export function sniffContainer(head: Uint8Array): "isobmff" | "ebml" | null {
  if (head.length >= 12) {
    const ftyp = String.fromCharCode(head[4]!, head[5]!, head[6]!, head[7]!);
    if (ftyp === "ftyp") return "isobmff";
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "ebml";
  return null;
}

export function expectedContainer(ext: AcceptedExt): "isobmff" | "ebml" {
  return ext === "webm" || ext === "mkv" ? "ebml" : "isobmff";
}
