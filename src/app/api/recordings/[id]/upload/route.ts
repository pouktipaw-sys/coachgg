import { authedOrDevice, json } from "@/server/http";
import { badRequest } from "@/server/errors";
import { appendChunk, uploadState } from "@/server/video/uploads";
import { env } from "@/lib/env";

type P = { id: string };

// Navigateur (session) ou application PC (jeton d'appareil) : même protocole reprenable.
export const GET = authedOrDevice<P>(async (_req, user, { id }) => json(await uploadState(user.id, id)));

export const PUT = authedOrDevice<P>(async (req, user, { id }) => {
  const offset = Number(req.headers.get("upload-offset"));
  if (!Number.isInteger(offset) || offset < 0) throw badRequest("En-tête Upload-Offset manquant ou invalide.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > env.chunkBytes) throw badRequest("Morceau trop volumineux.");
  const data = new Uint8Array(await req.arrayBuffer());
  return json(await appendChunk(user.id, id, offset, data));
});
