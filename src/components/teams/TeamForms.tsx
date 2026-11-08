"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";

export function CreateTeamForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="card space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          const r = await api<{ team: { id: string } }>("/api/teams", {
            method: "POST",
            json: { name: f.get("name"), description: f.get("description") || null, imageUrl: f.get("imageUrl") || null },
          });
          router.push(`/app/teams/${r.team.id}`);
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <h2 className="h2">Créer un groupe</h2>
      <div>
        <label className="label" htmlFor="t-name">Nom</label>
        <input id="t-name" name="name" className="input" required minLength={2} maxLength={50} />
      </div>
      <div>
        <label className="label" htmlFor="t-desc">Description</label>
        <input id="t-desc" name="description" className="input" maxLength={300} />
      </div>
      <div>
        <label className="label" htmlFor="t-img">Image (URL https, facultatif)</label>
        <input id="t-img" name="imageUrl" type="url" className="input" maxLength={500} />
      </div>
      {msg && <p role="alert" className="text-sm text-loss">{msg}</p>}
      <button className="btn-primary">Créer</button>
    </form>
  );
}

export function InviteForm({ teamId }: { teamId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const email = new FormData(form).get("email");
        try {
          const r = await api<{ message: string }>(`/api/teams/${teamId}/invitations`, { method: "POST", json: { email } });
          setMsg(r.message);
          form.reset();
          router.refresh();
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <input name="email" type="email" required placeholder="email@ami.fr" className="input max-w-xs" aria-label="Email de l'ami à inviter" />
      <button className="btn-primary">Inviter</button>
      {msg && <p role="status" className="w-full text-xs text-muted">{msg}</p>}
    </form>
  );
}

export function TeamSettingsForm({ team }: { team: { id: string; name: string; description: string | null; imageUrl: string | null } }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await api(`/api/teams/${team.id}`, {
            method: "PATCH",
            json: { name: f.get("name"), description: f.get("description") || null, imageUrl: f.get("imageUrl") || null },
          });
          setMsg("Enregistré.");
          router.refresh();
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <input name="name" defaultValue={team.name} className="input" aria-label="Nom du groupe" required minLength={2} maxLength={50} />
      <input name="description" defaultValue={team.description ?? ""} className="input" aria-label="Description" maxLength={300} />
      <input name="imageUrl" defaultValue={team.imageUrl ?? ""} className="input" aria-label="Image" placeholder="https://…" />
      <button className="btn-ghost">Enregistrer</button>
      {msg && <p role="status" className="text-xs text-muted">{msg}</p>}
    </form>
  );
}
