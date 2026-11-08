"use client";
// Envoi de vidéo par morceaux avec progression, reprise automatique après
// coupure réseau, reprise manuelle après rechargement, et annulation.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/client";

const ACCEPT = ".mp4,.m4v,.mov,.webm,.mkv";
const EXT_OK = /\.(mp4|m4v|mov|webm|mkv)$/i;

type Phase =
  | { k: "idle" }
  | { k: "uploading"; sent: number; total: number; speed: number; retrying?: string }
  | { k: "processing"; progress: number; status: string }
  | { k: "ready" }
  | { k: "error"; message: string; canResume: boolean }
  | { k: "cancelled" };

type ResumeTarget = { id: string; filename: string; sizeBytes: number };

function putChunk(url: string, offset: number, blob: Blob, onProgress: (n: number) => void, xhrRef: { current: XMLHttpRequest | null }) {
  return new Promise<{ receivedBytes: number; complete: boolean }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", url);
    xhr.setRequestHeader("Upload-Offset", String(offset));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let data: { message?: string; error?: string; details?: unknown; receivedBytes?: number; complete?: boolean } = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as { receivedBytes: number; complete: boolean });
      else reject(new ApiError(xhr.status, data.error ?? "error", data.message ?? `Erreur ${xhr.status}`, data.details));
    };
    xhr.onerror = () => reject(new TypeError("network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    xhr.send(blob);
  });
}

export function Uploader({ matches, resume }: { matches: { id: string; label: string }[]; resume?: ResumeTarget | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [matchId, setMatchId] = useState("");
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [recordingId, setRecordingId] = useState<string | null>(resume?.id ?? null);
  const [clientError, setClientError] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelled = useRef(false);

  function pick(f: File | null) {
    setClientError(null);
    if (!f) return setFile(null);
    if (!EXT_OK.test(f.name)) return setClientError("Format non pris en charge (MP4, MOV, M4V, WEBM, MKV).");
    if (resume && (f.name !== resume.filename || f.size !== resume.sizeBytes))
      return setClientError(`Pour reprendre, sélectionnez le même fichier : ${resume.filename}.`);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  async function sendFrom(id: string, f: File, startOffset: number, chunkSize: number) {
    let offset = startOffset;
    let failures = 0;
    let t0 = performance.now();
    let bytesAtT0 = offset;
    while (offset < f.size) {
      if (cancelled.current) return false;
      const end = Math.min(f.size, offset + chunkSize);
      try {
        const r = await putChunk(`/api/recordings/${id}/upload`, offset, f.slice(offset, end), (n) => {
          const sent = offset + n;
          const dt = (performance.now() - t0) / 1000;
          setPhase({ k: "uploading", sent, total: f.size, speed: dt > 0.5 ? (sent - bytesAtT0) / dt : 0 });
        }, xhrRef);
        offset = r.receivedBytes;
        failures = 0;
        if (performance.now() - t0 > 5000) {
          t0 = performance.now();
          bytesAtT0 = offset;
        }
      } catch (e) {
        if (cancelled.current || (e instanceof DOMException && e.name === "AbortError")) return false;
        if (e instanceof ApiError && e.code === "offset_mismatch") {
          offset = (e.details as { receivedBytes: number }).receivedBytes;
          continue;
        }
        if (e instanceof ApiError && e.status < 500 && e.status !== 429) throw e; // erreur définitive (format, quota…)
        failures++;
        if (failures > 6) throw new Error("Connexion perdue. Vous pourrez reprendre l'envoi plus tard depuis la bibliothèque.");
        const wait = Math.min(30, 2 ** failures);
        setPhase({ k: "uploading", sent: offset, total: f.size, speed: 0, retrying: `Coupure réseau — nouvel essai dans ${wait} s (${failures}/6)` });
        await new Promise((r) => setTimeout(r, wait * 1000));
        try {
          const s = await api<{ receivedBytes: number }>(`/api/recordings/${id}/upload`);
          offset = s.receivedBytes;
        } catch {}
      }
    }
    return true;
  }

  async function start() {
    if (!file) return;
    cancelled.current = false;
    setPhase({ k: "uploading", sent: 0, total: file.size, speed: 0 });
    try {
      let id = recordingId;
      let offset = 0;
      let chunk = 8 * 1024 * 1024;
      if (id) {
        // Reprise : on demande au serveur combien d'octets il a déjà reçus.
        const s = await api<{ receivedBytes: number; chunkSize: number }>(`/api/recordings/${id}/upload`);
        offset = s.receivedBytes;
        chunk = s.chunkSize;
      } else {
        const r = await api<{ id: string; chunkSize: number }>("/api/recordings", {
          method: "POST",
          json: { filename: file.name, sizeBytes: file.size, mimeType: file.type, title, matchId: matchId || undefined },
        });
        id = r.id;
        chunk = r.chunkSize;
        setRecordingId(id);
      }
      const ok = await sendFrom(id!, file, offset, chunk);
      if (ok) setPhase({ k: "processing", progress: 0, status: "UPLOADED" });
    } catch (e) {
      setPhase({ k: "error", message: errorMessage(e), canResume: !(e instanceof ApiError && e.status < 500) });
    }
  }

  async function cancel() {
    cancelled.current = true;
    xhrRef.current?.abort();
    if (recordingId) await api(`/api/recordings/${recordingId}`, { method: "DELETE" }).catch(() => {});
    setPhase({ k: "cancelled" });
    setRecordingId(null);
  }

  // Suivi du traitement serveur après l'envoi.
  useEffect(() => {
    if (phase.k !== "processing" || !recordingId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ recording: { status: string; errorMessage: string | null }; processingJob: { progress: number } | null }>(
          `/api/recordings/${recordingId}`,
        );
        if (stop) return;
        if (r.recording.status === "READY") return setPhase({ k: "ready" });
        if (r.recording.status === "FAILED")
          return setPhase({ k: "error", message: r.recording.errorMessage ?? "Échec du traitement.", canResume: false });
        setPhase({ k: "processing", progress: r.processingJob?.progress ?? 0, status: r.recording.status });
      } catch {}
      if (!stop) setTimeout(tick, 1500);
    };
    const t = setTimeout(tick, 800);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [phase.k, recordingId]);

  const pct = phase.k === "uploading" ? Math.floor((phase.sent / phase.total) * 100) : 0;

  return (
    <div className="card space-y-5">
      {resume && (
        <p className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm">
          Reprise de l&apos;envoi de <strong>{resume.filename}</strong>. Sélectionnez à nouveau ce fichier : l&apos;envoi reprendra là où il s&apos;est arrêté.
        </p>
      )}
      <label
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line p-8 text-center hover:border-accent/60"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files[0] ?? null);
        }}
      >
        <span className="text-3xl" aria-hidden>⬆</span>
        <span className="font-medium">{file ? file.name : "Glissez une vidéo ou cliquez pour choisir"}</span>
        <span className="text-xs text-muted">
          {file ? `${(file.size / 1024 ** 2).toFixed(1)} Mo` : "MP4, MOV, M4V, WEBM, MKV — 4 Go max. La vidéo reste privée."}
        </span>
        <input
          data-testid="file-input"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={phase.k === "uploading" || phase.k === "processing"}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </label>
      {clientError && <p role="alert" className="text-sm text-loss">{clientError}</p>}

      {!resume && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="rec-title">Titre</label>
            <input id="rec-title" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rec-match">Associer à un match (optionnel)</label>
            <select id="rec-match" className="input" value={matchId} onChange={(e) => setMatchId(e.target.value)}>
              <option value="">— Aucun pour l&apos;instant —</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {phase.k === "uploading" && (
        <div aria-live="polite">
          <div className="flex justify-between text-sm">
            <span>Envoi… {pct} %</span>
            <span className="text-muted">{phase.speed > 0 ? `${(phase.speed / 1024 ** 2).toFixed(1)} Mo/s` : ""}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-panel-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          {phase.retrying && <p className="mt-2 text-sm text-warn">{phase.retrying}</p>}
        </div>
      )}
      {phase.k === "processing" && (
        <div aria-live="polite">
          <p className="text-sm">
            Envoi terminé. Traitement serveur (vérification, conversion, miniature)… {phase.progress} %
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded bg-panel-2">
            <div className="anim-pulse h-full bg-win/70 transition-all" style={{ width: `${Math.max(5, phase.progress)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">Le worker doit être lancé (npm run worker). Vous pouvez quitter cette page : une notification vous préviendra.</p>
        </div>
      )}
      {phase.k === "ready" && (
        <div role="status" className="rounded-lg border border-win/40 bg-win/10 p-3 text-sm">
          Vidéo prête.{" "}
          <Link className="font-medium underline" href={`/app/videos/${recordingId}`}>Ouvrir le lecteur de coaching →</Link>
        </div>
      )}
      {phase.k === "error" && (
        <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 p-3 text-sm text-loss">
          {phase.message}
        </p>
      )}
      {phase.k === "cancelled" && <p className="text-sm text-muted">Envoi annulé, fichier supprimé du serveur.</p>}

      <div className="flex flex-wrap gap-2">
        {(phase.k === "idle" || phase.k === "cancelled" || (phase.k === "error" && phase.canResume)) && (
          <button className="btn-primary" disabled={!file} onClick={start}>
            {phase.k === "error" || resume ? "Reprendre l'envoi" : "Envoyer la vidéo"}
          </button>
        )}
        {(phase.k === "uploading" || (phase.k === "error" && recordingId)) && (
          <button className="btn-danger" onClick={cancel}>Annuler et supprimer</button>
        )}
      </div>
    </div>
  );
}
