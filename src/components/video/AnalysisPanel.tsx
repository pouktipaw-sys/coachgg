"use client";
// Panneau « Analyse assistée » : lancement, suivi du pipeline étape par étape,
// annulation, limites explicites.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client";

export type AnalysisJobDTO = {
  id: string;
  status: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  processingMs: number | null;
  costMicros: number;
  finishedAt: string | null;
  result: {
    version?: string;
    contextSec?: number;
    created?: number;
    clipsCreated?: number;
    warnings?: string[];
    steps?: { name: string; status: string; ms: number; note?: string }[];
  } | null;
} | null;

const STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "En attente", tone: "text-accent-2" },
  RUNNING: { label: "En cours", tone: "text-accent-2" },
  SUCCEEDED: { label: "Terminée — aucune séquence détectée", tone: "text-win" },
  PARTIAL: { label: "Partiellement terminée", tone: "text-warn" },
  NEEDS_REVIEW: { label: "Terminée — validation nécessaire", tone: "text-warn" },
  FAILED: { label: "Échec", tone: "text-loss" },
  CANCELLED: { label: "Annulée", tone: "text-muted" },
};
const ICON: Record<string, string> = { ok: "✓", skipped: "–", warning: "!", failed: "✕" };

export function AnalysisPanel({
  recordingId,
  initial,
  clipDefaults = { deaths: true, fights: false },
}: {
  recordingId: string;
  initial: AnalysisJobDTO;
  clipDefaults?: { deaths: boolean; fights: boolean };
}) {
  const router = useRouter();
  const [job, setJob] = useState<AnalysisJobDTO>(initial);
  const [ctx, setCtx] = useState<number>(initial?.result?.contextSec ?? 10);
  const [msg, setMsg] = useState<string | null>(null);
  const [clipDeaths, setClipDeaths] = useState(clipDefaults.deaths);
  const [clipFights, setClipFights] = useState(clipDefaults.fights);
  const active = job && (job.status === "PENDING" || job.status === "RUNNING");

  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ analysisJob: AnalysisJobDTO }>(`/api/recordings/${recordingId}`);
        if (stop) return;
        setJob(r.analysisJob);
        if (r.analysisJob && !["PENDING", "RUNNING"].includes(r.analysisJob.status)) {
          router.refresh();
          return;
        }
      } catch {}
      if (!stop) setTimeout(tick, 2000);
    };
    const t = setTimeout(tick, 1000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [active, recordingId, router]);

  async function launch() {
    setMsg(null);
    try {
      await api(`/api/recordings/${recordingId}/analyze`, { method: "POST", json: { contextSec: ctx, autoClips: { deaths: clipDeaths, fights: clipFights } } });
      setJob((j) => ({ ...(j ?? { id: "", attempts: 0, maxAttempts: 2, error: null, processingMs: null, costMicros: 0, finishedAt: null, result: null }), status: "PENDING", progress: 0 }));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  async function cancel() {
    try {
      await api(`/api/recordings/${recordingId}/analyze`, { method: "DELETE" });
      setMsg("Annulation demandée.");
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  const st = job ? STATUS[job.status] ?? { label: job.status, tone: "" } : null;
  return (
    <section className="card space-y-3" aria-label="Analyse assistée" data-testid="analysis-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="h2">Analyse assistée <span className="badge ml-1 border-warn/40 text-warn">expérimentale</span></h2>
          <p className="mt-1 text-xs text-muted">
            Repère automatiquement des séquences à revoir à partir de signaux visibles dans l&apos;image. Les propositions restent des brouillons
            jusqu&apos;à votre validation.
          </p>
          <p className="mt-1 text-xs text-accent-2">
            🎯 Analyse précise : lie la vidéo à sa partie importée de Riot (encadré « Informations ») et synchronise-la (onglet « Synchro ») — chaque vraie mort est alors analysée avec les faits de la partie (tueur, ennemis, alliés, balises, objectif perdu) et un schéma sur la minimap.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted" htmlFor="an-ctx">Contexte avant l&apos;événement</label>
          <select id="an-ctx" className="input w-20 py-1" value={ctx} onChange={(e) => setCtx(Number(e.target.value))} disabled={!!active}>
            {[6, 10, 15].map((n) => <option key={n} value={n}>{n} s</option>)}
          </select>
          {active ? (
            <button className="btn-ghost" onClick={cancel}>Annuler</button>
          ) : (
            <button className="btn-primary" onClick={launch} data-testid="analysis-launch">{job ? "Relancer l'analyse" : "Lancer l'analyse"}</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-muted">Découper automatiquement en clips :</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={clipDeaths} onChange={(e) => setClipDeaths(e.target.checked)} disabled={!!active} data-testid="auto-clip-deaths" /> les morts
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={clipFights} onChange={(e) => setClipFights(e.target.checked)} disabled={!!active} /> les combats probables
        </label>
      </div>

      {job && st && (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p>
            <span className={`font-medium ${st.tone}`} data-testid="analysis-status">{st.label}</span>
            {active && ` — ${job.progress} %`}
            {job.result?.created != null && !active && ` · ${job.result.created} proposition(s)`}
            {!!job.result?.clipsCreated && !active && (
              <>
                {" · "}
                <a className="underline" href={`/app/clips?recordingId=${recordingId}`} data-testid="auto-clips-link">{job.result.clipsCreated} clip(s) créé(s)</a>
              </>
            )}
            {job.processingMs != null && !active && <span className="text-muted"> · {(job.processingMs / 1000).toFixed(1)} s de traitement · coût externe {job.costMicros ? `${(job.costMicros / 1e6).toFixed(4)} €` : "nul (traitement local)"}</span>}
          </p>
          {active && (
            <div className="h-2 overflow-hidden rounded bg-panel-2"><div className="anim-pulse h-full bg-accent" style={{ width: `${Math.max(4, job.progress)}%` }} /></div>
          )}
          {job.error && !active && <p className="text-loss">{job.error}</p>}
          {job.result?.steps && (
            <ol className="space-y-1 text-xs">
              {job.result.steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className={`w-4 text-center ${s.status === "failed" ? "text-loss" : s.status === "warning" ? "text-warn" : s.status === "skipped" ? "text-muted" : "text-win"}`} aria-label={s.status}>{ICON[s.status] ?? "·"}</span>
                  <span className="flex-1"><strong>{s.name}</strong>{s.note ? <span className="text-muted"> — {s.note}</span> : null}</span>
                  <span className="font-mono text-muted">{s.ms} ms</span>
                </li>
              ))}
            </ol>
          )}
          {job.result?.version && <p className="text-xs text-muted">Règles {job.result.version} · contexte {job.result.contextSec} s · essai {job.attempts}/{job.maxAttempts}</p>}
        </div>
      )}
      {msg && <p role="status" className="text-xs text-muted">{msg}</p>}

      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Ce que l&apos;analyse détecte — et ne détecte pas</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Écran grisé</strong> (désaturation de la vue de jeu) → mort probable. Une mort n&apos;est jamais classée « erreur » automatiquement.</li>
          <li><strong>Forte activité visuelle</strong> → engagement probable, ou simple mouvement de caméra (non distinguables).</li>
          <li><strong>Marqueurs rouges sur la minimap</strong> apparus <em>avant</em> l&apos;événement — seulement si la zone minimap est définie. Leur nature n&apos;est pas identifiée.</li>
          <li>Pour chaque séquence : planche des secondes précédentes, observations chiffrées, confiance (jamais « élevée »).</li>
          <li>Non détecté : placement, compétences, ressources, objectifs, positions des champions, communications. Aucune lecture mémoire, aucune donnée de Riot.</li>
          <li>Précision sur de vraies parties : non mesurée à ce stade ; vos validations et rejets servent à la mesurer.</li>
        </ul>
      </details>
    </section>
  );
}
