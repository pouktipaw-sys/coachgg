import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { addGroundTruth, listGroundTruth } from "@/server/analysis/evaluation";

type P = { id: string };

export const GET = authed<P>(async (_req, user, { id }) => json({ events: await listGroundTruth(user.id, id) }));

/** Marque une mort réelle à un instant de la vidéo (vérité terrain manuelle). */
export const POST = authed<P>(async (req, user, { id }) => {
  const { videoMs } = z.object({ videoMs: z.number().int().min(0) }).parse(await readJson(req));
  return json({ event: await addGroundTruth(user.id, id, videoMs) }, 201);
});
