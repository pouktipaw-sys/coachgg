import { authed, json, readJson } from "@/server/http";
import { changeEmail } from "@/server/auth/service";

export const PATCH = authed(async (req, user) => json(await changeEmail(user.id, await readJson(req))));
