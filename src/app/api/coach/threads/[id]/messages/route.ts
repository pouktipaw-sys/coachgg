import { authed, json, readJson } from "@/server/http";
import { ask } from "@/server/coach/service";

type P = { id: string };

/** Pose une question au coach ; renvoie la réponse sourcée. */
export const POST = authed<P>(async (req, user, { id }) => json({ message: await ask(user.id, id, await readJson(req)) }, 201));
