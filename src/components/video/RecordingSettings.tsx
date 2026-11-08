"use client";
// Réglages d'une vidéo : titre, match associé, partages volontaires, suppression.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";

type Props = {
  recording: { id: string; title: string; matchId: string | null };
  matches: { id: string; label: string }[];
  teams: { id: string; name: string }[];
  shares: { id: string; label: string }[];
};

export function RecordingSettings({ recording, matches, teams, shares }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(recording.title);
  const [matchId, setMatchId] = useState(recording.matchId ?? "");
  const [teamId, setTeamId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg(ok);
      router.refresh();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <section className="mt-8 grid gap-4 lg:grid-cols-3">
      <div className="card space-y-3">
        <h2 className="h2">Informations</h2>
        <div>
          <label className="label" htmlFor="s-title">Titre</label>
          <input id="s-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor="s-match">Match associé</label>
          <select id="s-match" className="input" value={matchId} onChange={(e) => setMatchId(e.target.value)}>
            <option value="">— Aucun —</option>
            {matches.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <button className="btn-primary"
          onClick={() => run(() => api(`/api/recordings/${recording.id}`, { method: "PATCH", json: { title, matchId: matchId || null } }), "Enregistré.")}>
          Enregistrer
        </button>
      </div>

      <div className="card space-y-3">
        <h2 className="h2">Partage volontaire</h2>
        <p className="text-xs text-muted">
          La vidéo est privée. Être dans un groupe ne donne pas accès à vos vidéos : vous choisissez explicitement ce que vous partagez.
          Retirer un partage ou quitter le groupe coupe l&apos;accès immédiatement.
        </p>
        {shares.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {shares.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-1.5">
                <span>{s.label}</span>
                <button className="text-xs text-loss underline" onClick={() => run(() => api(`/api/shares/${s.id}`, { method: "DELETE" }), "Partage retiré.")}>
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Aucun partage actif.</p>
        )}
        {teams.length > 0 ? (
          <div className="flex gap-2">
            <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Groupe">
              <option value="">Choisir un groupe…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="btn-ghost" disabled={!teamId}
              onClick={() => run(() => api(`/api/recordings/${recording.id}/shares`, { method: "POST", json: { teamId } }), "Vidéo partagée avec le groupe.")}>
              Partager
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted">Rejoignez ou créez un groupe pour partager avec vos amis.</p>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="h2">Suppression</h2>
        <p className="text-xs text-muted">Supprime définitivement le fichier, les moments, annotations et partages associés.</p>
        <button className="btn-danger"
          onClick={() => {
            if (!confirm("Supprimer définitivement cette vidéo ?")) return;
            void run(async () => {
              await api(`/api/recordings/${recording.id}`, { method: "DELETE" });
              router.push("/app/videos");
            }, "Vidéo supprimée.");
          }}>
          Supprimer la vidéo
        </button>
      </div>
      {msg && <p role="status" className="text-sm text-muted lg:col-span-3">{msg}</p>}
    </section>
  );
}
