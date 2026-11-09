import { authed, json, readJson } from "@/server/http";
import { createThread, listThreads } from "@/server/coach/service";

export const GET = authed(async (_req, user) => json({ threads: await listThreads(user.id) }));
export const POST = authed(async (req, user) => json({ thread: await createThread(user.id, await readJson(req)) }, 201));
