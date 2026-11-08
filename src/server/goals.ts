// Objectifs individuels et collectifs, avec bilan mesuré sur les notes réelles.
import { z } from "zod";
import { prisma } from "./db";
import { notFound } from "./errors";
import { requireTeamMember } from "./permissions";
import { CURRENT_SCORE_CONFIG, COMPONENT_LABELS, type ComponentKey } from "@/lib/scoring/config";

const KEYS = ["resources", "participation", "damage", "risk", "vision", "objectives"] as const;

export const goalSchema = z.object({
  title: z.string().trim().min(3).max(120),
  reason: z.string().trim().max(500).optional(),
  expectedBehavior: z.string().trim().max(500).optional(),
  metricKey: z.enum(KEYS).optional(),
  metricTarget: z.number().min(0).max(10).optional(),
  periodDays: z.number().int().min(1).max(90).default(14),
  teamId: z.string().optional(),
});

export async function createGoal(userId: string, raw: unknown) {
  const g = goalSchema.parse(raw);
  if (g.teamId) await requireTeamMember(userId, g.teamId);
  return prisma.goal.create({
    data: {
      ownerId: g.teamId ? null : userId,
      teamId: g.teamId ?? null,
      title: g.title,
      reason: g.reason,
      expectedBehavior: g.expectedBehavior,
      metric: g.metricKey ? { key: g.metricKey, target: g.metricTarget ?? 6, comparator: "gte" } : undefined,
      periodEnd: new Date(Date.now() + g.periodDays * 86400_000),
    },
  });
}

async function goalAccess(userId: string, goalId: string) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal) throw notFound("Objectif");
  if (goal.ownerId === userId) return goal;
  if (goal.teamId) {
    await requireTeamMember(userId, goal.teamId);
    return goal;
  }
  throw notFound("Objectif");
}

export async function updateGoalStatus(userId: string, goalId: string, status: "ACTIVE" | "ACHIEVED" | "ABANDONED", review?: string) {
  await goalAccess(userId, goalId);
  return prisma.goal.update({ where: { id: goalId }, data: { status, review } });
}

export async function deleteGoal(userId: string, goalId: string) {
  await goalAccess(userId, goalId);
  await prisma.goal.delete({ where: { id: goalId } });
}

export type GoalProgress = { matches: number; met: number; label: string } | null;

/** Bilan : nombre de parties de la période où la dimension visée atteint la cible. */
export async function goalProgress(goal: { ownerId: string | null; teamId: string | null; metric: unknown; periodStart: Date; periodEnd: Date | null }): Promise<GoalProgress> {
  const metric = goal.metric as { key: ComponentKey; target: number } | null;
  if (!metric) return null;
  const userIds = goal.ownerId
    ? [goal.ownerId]
    : (await prisma.teamMembership.findMany({ where: { teamId: goal.teamId! }, select: { userId: true } })).map((m) => m.userId);
  const end = goal.periodEnd ?? new Date();
  const scores = await prisma.performanceScore.findMany({
    where: {
      scoreVersionId: CURRENT_SCORE_CONFIG.version,
      participant: {
        userId: { in: userIds },
        match: { isDemo: false, OR: [{ gameStartAt: { gte: goal.periodStart, lte: end } }, { gameStartAt: null, createdAt: { gte: goal.periodStart, lte: end } }] },
      },
    },
    select: { components: true },
  });
  let matches = 0;
  let met = 0;
  for (const s of scores) {
    const c = (s.components as { key: string; score: number | null; available: boolean }[]).find((x) => x.key === metric.key);
    if (!c?.available || c.score == null) continue;
    matches++;
    if (c.score >= metric.target) met++;
  }
  return { matches, met, label: `${COMPONENT_LABELS[metric.key]} ≥ ${metric.target}/10` };
}
