import { authed, json } from "@/server/http";
import { createPairingCode } from "@/server/devices";

/** Code à usage unique (10 min) à saisir dans l'application PC. */
export const POST = authed(async (_req, user) => json(await createPairingCode(user.id), 201));
