import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";
import { createTeam } from "@/server/teams/service";

export const GET = authed(async (_req, user) =>
  json({
    teams: await prisma.team.findMany({
      where: { memberships: { some: { userId: user.id } } },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: "desc" },
    }),
  }),
);

export const POST = authed(async (req, user) => json({ team: await createTeam(user.id, await readJson(req)) }, 201));
