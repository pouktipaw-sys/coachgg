"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";
import { COMPONENT_LABELS } from "@/lib/scoring/config";

export function GoalForm({ teamId }: { teamId?: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn-ghost" onClick={() => setOpen(true)}>+ Nouvel objectif{teamId ? " collectif" : ""}</button>;
  return (
    <form
      className="space-y-2 rounded-lg border border-line p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await api("/api/goals", {
            method: "POST",
            json: {
              title: f.get("title"),
              reason: f.get("reason") || undefined,
              expectedBehavior: f.get("expectedBehavior") || undefined,
              metricKey: f.get("metricKey") || undefined,
              metricTarget: f.get("metricKey") ? Number(f.get("metricTarget")) : undefined,
              periodDays: Number(f.get("periodDays")),
              teamId,
            },
          });
          setOpen(false);
          setMsg(null);
          router.refresh();
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <input name="title" className="input" placeholder="Titre (ex. Mourir moins seul en début de partie)" required minLength={3} maxLength={120} aria-label="Titre" />
      <input name="reason" className="input" placeholder="Pourquoi ?" maxLength={500} aria-label="Raison" />
      <input name="expectedBehavior" className="input" placeholder="Comportement attendu" maxLength={500} aria-label="Comportement attendu" />
      <div className="grid grid-cols-3 gap-2">
        <select name="metricKey" className="input" aria-label="Indicateur" defaultValue="">
          <option value="">Sans indicateur chiffré</option>
          {Object.entries(COMPONENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="metricTarget" className="input" aria-label="Cible" defaultValue="6">
          {[5, 6, 7, 8].map((n) => <option key={n} value={n}>≥ {n}/10</option>)}
        </select>
        <select name="periodDays" className="input" aria-label="Période" defaultValue="14">
          {[7, 14, 30].map((n) => <option key={n} value={n}>{n} jours</option>)}
        </select>
      </div>
      {msg && <p role="alert" className="text-xs text-loss">{msg}</p>}
      <div className="flex gap-2">
        <button className="btn-primary">Créer</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </form>
  );
}
