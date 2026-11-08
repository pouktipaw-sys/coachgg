import { authed, json, readJson } from "@/server/http";
import { createAnnotation } from "@/server/video/coaching";

type P = { id: string };

export const POST = authed<P>(async (req, user, { id }) =>
  json({ annotation: await createAnnotation(user.id, id, await readJson(req)) }, 201),
);
