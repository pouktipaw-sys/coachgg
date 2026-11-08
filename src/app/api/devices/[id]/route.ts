import { authed, json } from "@/server/http";
import { revokeDevice } from "@/server/devices";

type P = { id: string };

/** Révocation immédiate : le jeton de l'appareil cesse de fonctionner. */
export const DELETE = authed<P>(async (_req, user, { id }) => {
  await revokeDevice(user.id, id);
  return json({ ok: true });
});
