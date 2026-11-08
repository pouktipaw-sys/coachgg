import { authed } from "@/server/http";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { requireRecordingView } from "@/server/permissions";
import { storage } from "@/server/storage";

type P = { id: string };

export const GET = authed<P>(async (_req, user, { id }) => {
  await requireRecordingView(user.id, id);
  const rec = await prisma.recording.findUnique({ where: { id }, select: { thumbnailKey: true } });
  if (!rec?.thumbnailKey) throw notFound("Miniature");
  const size = await storage().size(rec.thumbnailKey);
  if (size == null) throw notFound("Miniature");
  return new Response(storage().readStream(rec.thumbnailKey), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(size), "Cache-Control": "private, max-age=3600" },
  });
});
