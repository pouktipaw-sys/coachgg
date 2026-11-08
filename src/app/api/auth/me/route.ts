import { authed, json } from "@/server/http";

export const GET = authed(async (_req, user) => json({ user }));
