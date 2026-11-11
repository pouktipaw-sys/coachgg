"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";

const PLATFORMS = ["EUW1", "EUN1", "NA1", "KR", "JP1", "BR1", "LA1", "LA2", "OC1", "TR1", "RU", "ME1", "SG2", "TW2", "VN2"];

export function AddTeammateForm({ defaultPlatform = "EUW1" }: { defaultPlatform?: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setMsg(null);
        try {
          await api("/api/teammates", { method: "POST", json: { riotId: f.get("riotId"), platform: f.get("platform"), nickname: f.get("nickname") || null } });
          form.reset();
          setMsg("Coéquipier ajouté.");
          router.refresh();
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <div>
        <label className="label" htmlFor="tm-id">Riot ID du coéquipier</label>
        <input id="tm-id" name="riotId" className="input w-56" placeholder="Pseudo#EUW" required />
      </div>
      <div>
        <label className="label" htmlFor="tm-pf">Serveur</label>
        <select id="tm-pf" name="platform" className="input w-28" defaultValue={defaultPlatform}>
          {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tm-nick">Surnom (facultatif)</label>
        <input id="tm-nick" name="nickname" className="input w-40" maxLength={30} />
      </div>
      <button className="btn-primary" data-testid="add-teammate">Ajouter</button>
      {msg && <p role="status" className="w-full text-sm text-muted">{msg}</p>}
    </form>
  );
}
