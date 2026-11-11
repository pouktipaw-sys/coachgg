import { authed, json, readJson } from "@/server/http";
import { HttpError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { createPost, listPosts } from "@/server/community";

export const GET = authed(async (req, user) => {
  const sp = new URL(req.url).searchParams;
  return json(await listPosts(user.id, { kind: sp.get("kind") ?? undefined, reels: sp.get("reels") === "1", cursor: sp.get("cursor") ?? undefined }));
});

export const POST = authed(async (req, user) => {
  if (!rateLimit(`community-post:${user.id}`, 10, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de publications récentes.");
  return json({ post: await createPost(user.id, await readJson(req)) }, 201);
});
