import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";
import { requireRecordingOwner, requireTeamMember } from "@/server/permissions";

type P = { id: string };

export const GET = authed<P>(async (_req, user, { id }) => {
  await requireRecordingOwner(user.id, id);
  const shares = await prisma.sharePermission.findMany({ where: { recordingId: id, revokedAt: null } });
  return json({ shares });
});

const schema = z.object({ teamId: z.string().optional(), userId: z.string().optional() }).refine((x) => !!x.teamId !== !!x.userId, "Indiquez un groupe OU un utilisateur.");

/** Partage explicite d'une vidéo avec un groupe dont on est membre, ou un utilisateur. */
export const POST = authed<P>(async (req, user, { id }) => {
  await requireRecordingOwner(user.id, id);
  const input = schema.parse(await readJson(req));
  if (input.teamId) await requireTeamMember(user.id, input.teamId);
  if (input.userId) {
    if (input.userId === user.id) throw badRequest("Inutile de partager avec vous-même.");
    if (!(await prisma.user.count({ where: { id: input.userId } }))) throw notFound("Utilisateur");
  }
  const existing = await prisma.sharePermission.findFirst({
    where: { recordingId: id, revokedAt: null, granteeTeamId: input.teamId ?? null, granteeUserId: input.userId ?? null },
  });
  const share =
    existing ??
    (await prisma.sharePermission.create({
      data: { recordingId: id, grantedById: user.id, granteeTeamId: input.teamId, granteeUserId: input.userId },
    }));
  return json({ share }, existing ? 200 : 201);
});
