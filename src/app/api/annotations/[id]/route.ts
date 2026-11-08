import { authed, json, readJson } from "@/server/http";
import { deleteAnnotation, updateAnnotation } from "@/server/video/coaching";

type P = { id: string };

export const PUT = authed<P>(async (req, user, { id }) =>
  json({ annotation: await updateAnnotation(user.id, id, await readJson(req)) }),
);

export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteAnnotation(user.id, id);
  return json({ ok: true });
});
