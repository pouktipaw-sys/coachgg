import { cookies } from "next/headers";
import { authed, json } from "@/server/http";
import { logoutOtherSessions } from "@/server/auth/service";
import { SESSION_COOKIE } from "@/server/auth/session";

/** Déconnecte tous les autres appareils (la session courante reste ouverte). */
export const DELETE = authed(async (_req, user) => json(await logoutOtherSessions(user.id, (await cookies()).get(SESSION_COOKIE)?.value)));
