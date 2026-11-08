import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { prisma } from "@/server/db";

const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;

const schema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),
  primaryRole: z.enum(ROLES).nullable().optional(),
  secondaryRole: z.enum(ROLES).nullable().optional(),
  favoriteChampions: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  progressGoal: z.string().trim().max(300).nullable().optional(),
  explanationLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional(),
  explanationDensity: z.enum(["concise", "normal", "detailed"]).optional(),
  language: z.enum(["fr", "en"]).optional(),
  shareStatsWithTeams: z.boolean().optional(),
  retentionDays: z.number().int().min(7).max(3650).nullable().optional(),
  completeOnboarding: z.boolean().optional(),
});

export const GET = authed(async (_req, user) => {
  const profile = await prisma.playerProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
  return json({ profile });
});

export const PUT = authed(async (req, user) => {
  const { displayName, completeOnboarding, ...p } = schema.parse(await readJson(req));
  if (displayName) await prisma.user.update({ where: { id: user.id }, data: { displayName } });
  const data = { ...p, ...(completeOnboarding ? { onboardingCompletedAt: new Date() } : {}) };
  const profile = await prisma.playerProfile.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
  return json({ profile });
});
