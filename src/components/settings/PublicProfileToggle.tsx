"use client";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";

export function PublicProfileToggle({ enabled: initial, slug: initialSlug }: { enabled: boolean; slug: string | null }) {
  const [enabled, setEnabled] = useState(initial);
  const [slug, setSlug] = useState(initialSlug);
  const [msg, setMsg] = useState<string | null>(null);
  const url = slug && typeof window !== "undefined" ? `${window.location.origin}/u/${slug}` : slug ? `/u/${slug}` : null;
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          data-testid="public-toggle"
          onChange={async (e) => {
            try {
              const r = await api<{ enabled: boolean; slug: string }>("/api/profile/public", { method: "POST", json: { enabled: e.target.checked } });
              setEnabled(r.enabled);
              setSlug(r.slug);
              setMsg(r.enabled ? "Profil public activé." : "Profil public désactivé : le lien ne fonctionne plus.");
            } catch (err) {
              setMsg(errorMessage(err));
            }
          }}
        />
        Rendre mon profil public (lien partageable)
      </label>
      <p className="text-xs text-muted">Visible par toute personne qui a le lien : pseudo, Riot ID, rang, statistiques, champions, dernières parties. Jamais tes vidéos, tes moments de coaching ni tes amis.</p>
      {enabled && url && (
        <div className="flex flex-wrap items-center gap-2">
          <a className="text-accent-2 underline" href={url} target="_blank" rel="noreferrer" data-testid="public-link">{url}</a>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(url).then(() => setMsg("Lien copié."))}>Copier le lien</button>
        </div>
      )}
      {msg && <p role="status" className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
