import { authed, json, readJson } from "@/server/http";
import { createGoal } from "@/server/goals";

export const POST = authed(async (req, user) => json({ goal: await createGoal(user.id, await readJson(req)) }, 201));
