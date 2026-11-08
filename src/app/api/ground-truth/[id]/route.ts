import { authed, json } from "@/server/http";
import { deleteGroundTruth } from "@/server/analysis/evaluation";

type P = { id: string };

export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteGroundTruth(user.id, id);
  return json({ ok: true });
});
