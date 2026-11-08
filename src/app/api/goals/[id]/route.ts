import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { deleteGoal, updateGoalStatus } from "@/server/goals";

type P = { id: string };

export const PATCH = authed<P>(async (req, user, { id }) => {
  const { status, review } = z
    .object({ status: z.enum(["ACTIVE", "ACHIEVED", "ABANDONED"]), review: z.string().trim().max(1000).optional() })
    .parse(await readJson(req));
  return json({ goal: await updateGoalStatus(user.id, id, status, review) });
});

export const DELETE = authed<P>(async (_req, user, { id }) => {
  await deleteGoal(user.id, id);
  return json({ ok: true });
});
