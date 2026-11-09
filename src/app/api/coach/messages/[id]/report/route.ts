import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { reportMessage } from "@/server/coach/service";

type P = { id: string };

/** Signalement d'une réponse incorrecte (avec correction proposée en commentaire). */
export const POST = authed<P>(async (req, user, { id }) => {
  const { comment } = z.object({ comment: z.string().trim().max(1000).optional() }).parse(await readJson(req));
  return json({ message: await reportMessage(user.id, id, comment) });
});
