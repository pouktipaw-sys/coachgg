"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client";

type Job = { status: string; progress: number; attempts: number; maxAttempts: number; error: string | null } | null;

export function RecordingStatusPanel({ id, status, errorMessage: err, isOwner }: { id: string; status: string; errorMessage: string | null; isOwner: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState<Job>(null);
  const [cur, setCur] = useState(status);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!["UPLOADED", "PROCESSING"].includes(cur)) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ recording: { status: string }; processingJob: Job }>(`/api/recordings/${id}`);
        if (stop) return;
        setJob(r.processingJob);
        if (r.recording.status !== cur) {
          setCur(r.recording.status);
          if (r.recording.status === "READY" || r.recording.status === "FAILED") router.refresh();
        }
      } catch {}
      if (!stop) setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [cur, id, router]);

  async function act(path: "retry" | "cancel") {
    try {
      await api(`/api/recordings/${id}/${path}`, { method: "POST" });
      setMsg(path === "retry" ? "Traitement relancé." : "Annulation demandée.");
      setCur(path === "retry" ? "UPLOADED" : cur);
      router.refresh();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <div className="card space-y-3" aria-live="polite">
      {cur === "UPLOADING" && (
        <>
          <p>L&apos;envoi de cette vidéo n&apos;est pas terminé.</p>
          {isOwner && <Link className="btn-primary" href={`/app/videos/upload?resume=${id}`}>Reprendre l&apos;envoi</Link>}
        </>
      )}
      {(cur === "UPLOADED" || cur === "PROCESSING") && (
        <>
          <p>
            {cur === "UPLOADED" ? "En attente du worker de traitement…" : "Traitement en cours (vérification, conversion, miniature)…"}{" "}
            {job ? `${job.progress} %` : ""}
          </p>
          <div className="h-2 overflow-hidden rounded bg-panel-2">
            <div className="anim-pulse h-full bg-accent" style={{ width: `${Math.max(5, job?.progress ?? 0)}%` }} />
          </div>
          {job && job.attempts > 1 && <p className="text-xs text-warn">Tentative {job.attempts}/{job.maxAttempts}{job.error ? ` — ${job.error}` : ""}</p>}
          <p className="text-xs text-muted">Si rien ne bouge, vérifiez que le worker est lancé : <code>npm run worker</code>.</p>
          {isOwner && <button className="btn-ghost" onClick={() => act("cancel")}>Annuler le traitement</button>}
        </>
      )}
      {cur === "FAILED" && (
        <>
          <p className="text-loss">Échec : {err ?? "erreur inconnue"}</p>
          {isOwner && (
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => act("retry")}>Relancer le traitement</button>
            </div>
          )}
        </>
      )}
      {msg && <p className="text-sm text-muted">{msg}</p>}
    </div>
  );
}
