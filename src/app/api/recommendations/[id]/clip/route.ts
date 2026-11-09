import { authed, json } from "@/server/http";
import { clipFromMoment } from "@/server/clips";

type P = { id: string };

/** Enregistre un moment de coaching dans la bibliothèque de clips. */
export const POST = authed<P>(async (_req, user, { id }) => json({ clip: await clipFromMoment(user.id, id) }, 201));
