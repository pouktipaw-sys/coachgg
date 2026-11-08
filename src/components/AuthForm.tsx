"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";

type Mode = "login" | "register" | "forgot" | "reset";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "login") {
        await api("/api/auth/login", { method: "POST", json: { email: f.get("email"), password: f.get("password") } });
        router.push(params.get("next")?.startsWith("/app") ? params.get("next")! : "/app");
        router.refresh();
      } else if (mode === "register") {
        await api("/api/auth/register", {
          method: "POST",
          json: { email: f.get("email"), password: f.get("password"), displayName: f.get("displayName") },
        });
        router.push("/app/onboarding");
        router.refresh();
      } else if (mode === "forgot") {
        const r = await api<{ message: string }>("/api/auth/forgot", { method: "POST", json: { email: f.get("email") } });
        setInfo(r.message);
      } else {
        await api("/api/auth/reset", { method: "POST", json: { token: params.get("token"), password: f.get("password") } });
        setInfo("Mot de passe modifié. Vous pouvez vous connecter.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = {
    login: "Connexion",
    register: "Créer un compte",
    forgot: "Mot de passe oublié",
    reset: "Nouveau mot de passe",
  };

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4" noValidate={false}>
      <h1 className="h1">{titles[mode]}</h1>
      {mode === "register" && (
        <div>
          <label className="label" htmlFor="displayName">Pseudo CoachGG</label>
          <input className="input" id="displayName" name="displayName" required minLength={2} maxLength={40} autoComplete="nickname" />
        </div>
      )}
      {mode !== "reset" && (
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" />
        </div>
      )}
      {mode !== "forgot" && (
        <div>
          <label className="label" htmlFor="password">Mot de passe CoachGG</label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            required
            minLength={mode === "login" ? 1 : 10}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {mode !== "login" && <p className="mt-1 text-xs text-muted">10 caractères minimum.</p>}
        </div>
      )}
      {mode === "register" && (
        <p className="rounded-lg border border-warn/30 bg-warn/5 p-2 text-xs text-warn">
          N&apos;utilisez jamais votre mot de passe Riot ici. CoachGG ne le demande et ne le stocke jamais.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      {info && <p role="status" className="text-sm text-win">{info}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "…" : titles[mode]}</button>
      <div className="flex justify-between text-xs text-muted">
        {mode === "login" && (
          <>
            <Link href="/register" className="hover:text-text">Créer un compte</Link>
            <Link href="/forgot-password" className="hover:text-text">Mot de passe oublié ?</Link>
          </>
        )}
        {mode !== "login" && <Link href="/login" className="hover:text-text">← Connexion</Link>}
      </div>
      {mode === "forgot" && (
        <p className="text-xs text-muted">
          Envoi d&apos;emails non configuré dans cette version : en développement, le lien apparaît dans les logs du serveur.
        </p>
      )}
    </form>
  );
}
