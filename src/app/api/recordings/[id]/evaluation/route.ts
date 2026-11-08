import { authed, json } from "@/server/http";
import { evaluateRecordingForOwner } from "@/server/analysis/evaluation";

type P = { id: string };

export const GET = authed<P>(async (_req, user, { id }) => json({ evaluation: await evaluateRecordingForOwner(user.id, id) }));
