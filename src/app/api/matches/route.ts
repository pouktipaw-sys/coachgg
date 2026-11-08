import { authed, json, readJson } from "@/server/http";
import { createManualMatch } from "@/server/matches/service";
import { listUserMatches, parseMatchFilters } from "@/server/matches/queries";

export const GET = authed(async (req, user) => {
  const filters = parseMatchFilters(Object.fromEntries(req.nextUrl.searchParams));
  return json({ matches: await listUserMatches(user.id, filters) });
});

export const POST = authed(async (req, user) => {
  const match = await createManualMatch(user.id, await readJson(req));
  return json({ match }, 201);
});
