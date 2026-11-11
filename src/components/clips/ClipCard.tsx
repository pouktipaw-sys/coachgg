"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client";
import { KIND_LABELS, MOMENT_KINDS } from "@/lib/annotations/schema";
import { formatMs } from "@/lib/annotations/coaching";

export type ClipDTO = {
  id: string;
  title: string;
  kind: (typeof MOMENT_KINDS)[number];
  startMs: number;
  endMs: number;
  favorite: boolean;
  personalNote: string | null;
  provenance: string;
  exportStatus: string | null;
  exportError: string | null;
  recording: { id: string; title: string; ownerId: string; thumbnailKey: string | null; owner: { displayName: string } };
};

export function ClipCard({ clip, me }: { clip: ClipDTO; me: string }) {
  const router = useRouter();
  const [c, setC] = useState(clip);
  const [note, setNote] = useState(clip.personalNote ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  // Suivi du rendu de l'export
  useEffect(() => {
    if (c.exportStatus !== "PENDING" && c.exportStatus !== "RUNNING") return;
    const t = setInterval(async () => {
      const r = await api<{ clips: ClipDTO[] }>(`/api/clips?recordingId=${c.recording.id}`).catch(() => null);
      const u = r?.clips.find((x) => x.id === c.id);
      if (u && u.exportStatus !== c.exportStatus) setC((s) => ({ ...s, exportStatus: u.exportStatus, exportError: u.exportError }));
    }, 2000);
    return () => clearInterval(t);
  }, [c.exportStatus, c.id, c.recording.id]);

  async function patch(data: Partial<ClipDTO>) {
    try {
      const r = await api<{ clip: ClipDTO }>(`/api/clips/${c.id}`, { method: "PATCH", json: data });
      setC((s) => ({ ...s, ...r.clip }));
      setMsg(null);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <li className="card flex flex-col gap-3 p-4" data-testid="clip-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link className="font-medium hover:underline" href={`/app/videos/${c.recording.id}?t=${c.startMs}`}>{c.title}</Link>
          <p className="text-xs text-muted">
            {c.provenance === "AUTOMATIC" && <span className="badge mr-1 border-warn/40 text-warn" title="Découpé automatiquement par l'analyse">auto</span>}
            {KIND_LABELS[c.kind]} · {formatMs(c.startMs)}–{formatMs(c.endMs)} ({Math.round((c.endMs - c.startMs) / 1000)} s) · {c.recording.title}
            {c.recording.ownerId !== me ? ` · partagée par ${c.recording.owner.displayName}` : ""}
          </p>
        </div>
        <button
          aria-pressed={c.favorite}
          aria-label={c.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
          className={`text-xl ${c.favorite ? "text-warn" : "text-muted hover:text-text"}`}
          onClick={() => patch({ favorite: !c.favorite })}
          data-testid="clip-favorite"
        >
          {c.favorite ? "★" : "☆"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto py-1 text-xs" value={c.kind} aria-label="Catégorie" onChange={(e) => patch({ kind: e.target.value as ClipDTO["kind"] })}>
          {MOMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
      </div>
      <textarea
        className="input text-sm"
        rows={2}
        placeholder="Note personnelle…"
        value={note}
        maxLength={2000}
        aria-label="Note personnelle"
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (c.personalNote ?? "") && patch({ personalNote: note || null })}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {c.exportStatus === "READY" ? (
          <a className="btn-primary px-2.5 py-1 text-xs" href={`/api/clips/${c.id}/export`} data-testid="clip-download">Télécharger la vidéo annotée</a>
        ) : c.exportStatus === "PENDING" || c.exportStatus === "RUNNING" ? (
          <span className="anim-pulse text-accent-2" data-testid="clip-export-status">Rendu de la vidéo annotée…</span>
        ) : (
          <button
            className="btn-ghost px-2.5 py-1 text-xs"
            data-testid="clip-export"
            onClick={async () => {
              try {
                await api(`/api/clips/${c.id}/export`, { method: "POST", json: {} });
                setC((s) => ({ ...s, exportStatus: "PENDING", exportError: null }));
              } catch (e) {
                setMsg(errorMessage(e));
              }
            }}
          >
            {c.exportStatus === "FAILED" ? "Réessayer l'export" : "Exporter avec les annotations"}
          </button>
        )}
        {c.exportStatus === "FAILED" && <span className="text-loss">{c.exportError}</span>}
        <button
          className="ml-auto text-loss underline"
          onClick={async () => {
            if (!confirm("Supprimer ce clip ? (la vidéo d'origine n'est pas touchée)")) return;
            await api(`/api/clips/${c.id}`, { method: "DELETE" });
            router.refresh();
          }}
        >
          Supprimer
        </button>
      </div>
      {msg && <p role="alert" className="text-xs text-loss">{msg}</p>}
    </li>
  );
}
