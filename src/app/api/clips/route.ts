import { authed, json, readJson } from "@/server/http";
import { createClip, listClips } from "@/server/clips";

export const GET = authed(async (req, user) => json({ clips: await listClips(user.id, Object.fromEntries(req.nextUrl.searchParams)) }));
export const POST = authed(async (req, user) => json({ clip: await createClip(user.id, await readJson(req)) }, 201));
