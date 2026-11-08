"use client";
// Petit client fetch typé pour les composants navigateur.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? `Erreur ${res.status}`, data?.details);
  }
  return data as T;
}

/** Message lisible à partir d'une erreur d'API (y compris détails de validation zod). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
    const extra = [...(d?.formErrors ?? []), ...Object.entries(d?.fieldErrors ?? {}).map(([k, v]) => `${k} : ${v.join(", ")}`)];
    return extra.length ? `${e.message} ${extra.join(" · ")}` : e.message;
  }
  return e instanceof Error ? e.message : "Erreur inattendue.";
}
