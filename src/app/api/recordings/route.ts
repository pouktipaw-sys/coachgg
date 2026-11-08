import { HttpError } from "@/server/errors";
import { authed, authedOrDevice, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/rateLimit";
import { prisma } from "@/server/db";
import { visibleRecordingWhere } from "@/server/permissions";
import { createUpload } from "@/server/video/uploads";

export const GET = authed(async (_req, user) => {
  const recordings = await prisma.recording.findMany({
    where: visibleRecordingWhere(user.id),
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, title: true, status: true, durationMs: true, createdAt: true, ownerId: true, matchId: true,
      sizeBytes: true, receivedBytes: true, errorMessage: true, thumbnailKey: true, isDemo: true,
      owner: { select: { displayName: true } },
      _count: { select: { recommendations: true, annotations: true } },
    },
  });
  return json({ recordings });
});

// Accessible aussi à l'application PC (jeton d'appareil).
export const POST = authedOrDevice(async (req, user, _params, device) => {
  if (!rateLimit(`upload-create:${user.id}`, 20, 3600_000))
    throw new HttpError(429, "rate_limited", "Trop d'envois créés récemment.");
  return json(await createUpload(user.id, await readJson(req), device), 201);
});
