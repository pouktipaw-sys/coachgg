import { z } from "zod";
import { authed, json, readJson } from "@/server/http";
import { setPublicProfile } from "@/server/publicProfile";

/** Active ou désactive le profil public (action explicite du joueur). */
export const POST = authed(async (req, user) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await readJson(req));
  return json(await setPublicProfile(user.id, enabled));
});
