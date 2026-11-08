import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { HttpError, unauthorized } from "./errors";
import { getCurrentUser, type SafeUser } from "./auth/session";
import { env } from "@/lib/env";

type Ctx<P> = { params: Promise<P> };

/** Sérialise (BigInt → number) et renvoie du JSON. */
export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(
    JSON.parse(JSON.stringify(data ?? null, (_k, v) => (typeof v === "bigint" ? Number(v) : v))),
    typeof init === "number" ? { status: init } : init,
  );
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.code, message: e.message, details: e.details }, e.status);
  if (e instanceof ZodError)
    return json({ error: "validation", message: "Données invalides.", details: e.flatten() }, 400);
  // Pas de données sensibles dans les logs : uniquement le message.
  console.error("[api] erreur inattendue :", e instanceof Error ? e.message : String(e));
  return json({ error: "internal", message: "Erreur interne." }, 500);
}

/** Protection CSRF : les requêtes mutantes d'un navigateur doivent venir de notre origine. */
function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // client non-navigateur : le cookie SameSite=Lax protège déjà
  const allowed = new Set([new URL(env.appUrl).origin, req.nextUrl.origin]);
  if (!allowed.has(origin)) throw new HttpError(403, "bad_origin", "Origine non autorisée.");
}

export function handler<P = Record<string, string>>(fn: (req: NextRequest, params: P) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      checkOrigin(req);
      return await fn(req, (await ctx?.params) as P);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function authed<P = Record<string, string>>(
  fn: (req: NextRequest, user: SafeUser, params: P) => Promise<Response>,
) {
  return handler<P>(async (req, params) => {
    const user = await getCurrentUser();
    if (!user) throw unauthorized();
    return fn(req, user, params);
  });
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "bad_json", "Corps JSON invalide.");
  }
}

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
