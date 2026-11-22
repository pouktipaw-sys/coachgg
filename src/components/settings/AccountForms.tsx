"use client";
// Compte CoachGG : changer l'email, le mot de passe, déconnecter les autres appareils.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";

function useStatus() {
  const [s, set] = useState<{ ok: boolean; text: string } | null>(null);
  return { s, ok: (text: string) => set({ ok: true, text }), err: (e: unknown) => set({ ok: false, text: errorMessage(e) }), clear: () => set(null) };
}
const Status = ({ s }: { s: { ok: boolean; text: string } | null }) =>
  s ? <p role={s.ok ? "status" : "alert"} className={`text-xs ${s.ok ? "text-win" : "text-loss"}`}>{s.text}</p> : null;

export function ChangeEmailForm({ email }: { email: string }) {
  const router = useRouter();
  const st = useStatus();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true);
        st.clear();
        try {
          await api("/api/account/email", { method: "PATCH", json: { email: f.get("email"), password: f.get("password") } });
          st.ok("Adresse email modifiée.");
          form.reset();
          router.refresh();
        } catch (err) {
          st.err(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-medium">Adresse email</h3>
      <p className="text-xs text-muted">Actuelle : {email}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="email" type="email" className="input" placeholder="Nouvelle adresse email" aria-label="Nouvelle adresse email" required autoComplete="email" />
        <input name="password" type="password" className="input" placeholder="Mot de passe actuel" aria-label="Mot de passe actuel pour changer l'email" required autoComplete="current-password" />
      </div>
      <button className="btn-ghost" disabled={busy}>Changer l&apos;email</button>
      <Status s={st.s} />
    </form>
  );
}

export function ChangePasswordForm() {
  const st = useStatus();
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        if (f.get("newPassword") !== f.get("confirm")) return st.err(new Error("Les deux nouveaux mots de passe ne sont pas identiques."));
        setBusy(true);
        st.clear();
        try {
          await api("/api/account/password", { method: "PATCH", json: { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") } });
          st.ok("Mot de passe modifié. Tes autres appareils ont été déconnectés.");
          form.reset();
        } catch (err) {
          st.err(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-medium">Mot de passe</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <input name="currentPassword" type={show ? "text" : "password"} className="input" placeholder="Mot de passe actuel" aria-label="Mot de passe actuel" required autoComplete="current-password" />
        <input name="newPassword" type={show ? "text" : "password"} className="input" placeholder="Nouveau mot de passe" aria-label="Nouveau mot de passe" required minLength={10} autoComplete="new-password" />
        <input name="confirm" type={show ? "text" : "password"} className="input" placeholder="Confirmer le nouveau" aria-label="Confirmer le nouveau mot de passe" required minLength={10} autoComplete="new-password" />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Afficher les mots de passe
      </label>
      <button className="btn-ghost" disabled={busy}>Changer le mot de passe</button>
      <p className="text-xs text-muted">Mot de passe oublié ? Déconnecte-toi puis utilise « Mot de passe oublié » sur la page de connexion.</p>
      <Status s={st.s} />
    </form>
  );
}

export function SessionsForm({ count }: { count: number }) {
  const router = useRouter();
  const st = useStatus();
  return (
    <div className="space-y-2">
      <h3 className="font-medium">Appareils connectés</h3>
      <p className="text-xs text-muted">{count} session(s) ouverte(s), celle-ci comprise.</p>
      <button
        className="btn-ghost"
        disabled={count <= 1}
        onClick={async () => {
          try {
            const r = await api<{ closed: number }>("/api/account/sessions", { method: "DELETE" });
            st.ok(`${r.closed} autre(s) appareil(s) déconnecté(s).`);
            router.refresh();
          } catch (err) {
            st.err(err);
          }
        }}
      >
        Déconnecter mes autres appareils
      </button>
      <Status s={st.s} />
    </div>
  );
}
