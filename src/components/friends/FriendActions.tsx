"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";

export function AddFriendForm({ defaultPlatform = "EUW1" }: { defaultPlatform?: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        try {
          const r = await api<{ message: string }>("/api/friends", { method: "POST", json: { riotId: f.get("riotId"), platform: f.get("platform") } });
          form.reset();
          setMsg({ ok: true, text: r.message });
          router.refresh();
        } catch (err) {
          setMsg({ ok: false, text: errorMessage(err) });
        }
      }}
    >
      <div className="min-w-56 flex-1">
        <label className="label" htmlFor="fr-id">Riot ID de ton pote</label>
        <input id="fr-id" name="riotId" className="input" placeholder="Pseudo#EUW" required autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="fr-pf">Serveur</label>
        <select id="fr-pf" name="platform" className="input w-28" defaultValue={defaultPlatform}>
          {["EUW1", "EUN1", "NA1", "KR", "JP1", "BR1", "LA1", "LA2", "OC1", "TR1", "RU", "ME1", "SG2", "TW2", "VN2"].map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <button className="btn-primary" data-testid="add-friend">➕ Ajouter</button>
      {msg && <p role="status" className={`w-full text-sm ${msg.ok ? "text-win" : "text-loss"}`}>{msg.text}</p>}
    </form>
  );
}

export function RequestButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const respond = async (accept: boolean) => {
    setBusy(true);
    try {
      await api(`/api/friends/${id}`, { method: "PATCH", json: { accept } });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex gap-2">
      <button className="btn-primary text-xs" disabled={busy} onClick={() => respond(true)} data-testid="accept-friend">Accepter</button>
      <button className="btn-ghost text-xs" disabled={busy} onClick={() => respond(false)}>Refuser</button>
    </span>
  );
}
