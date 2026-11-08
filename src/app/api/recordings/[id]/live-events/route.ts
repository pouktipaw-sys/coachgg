import { authedOrDevice, json, readJson } from "@/server/http";
import { ingestLiveEvents } from "@/server/devices";

type P = { id: string };

/** Événements de partie enregistrés par l'application PC, envoyés APRÈS le match. */
export const POST = authedOrDevice<P>(async (req, user, { id }) => json(await ingestLiveEvents(user.id, id, await readJson(req))));
