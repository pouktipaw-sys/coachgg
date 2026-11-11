import { authed, json, readJson } from "@/server/http";
import { addTeammate, listTeammates } from "@/server/teammates";

export const GET = authed(async (_req, user) => json({ teammates: await listTeammates(user.id) }));
export const POST = authed(async (req, user) => json({ teammate: await addTeammate(user.id, await readJson(req)) }, 201));
