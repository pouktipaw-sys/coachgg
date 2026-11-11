"use client";
// Fin d'analyse : bilan écrit de la partie et vidéo récap (moments annotés enchaînés).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client";

export type GameReportDTO = {
  summary: string;
  patterns: string[];
  priorities: { title: string; why: string; drill: string }[];
  nextGameGoal: string;
  source: "ai" | "rules";
  model?: string;
  moments: number;
  deaths: number;
  generatedAt: string;
} | null;

export function GameRecapPanel({
  recordingId,
  report,
  recap,
}: {
  recordingId: string;
  report: GameReportDTO;
  recap: { status: string | null; error: string | null; at: string | null };
}) {
  const router = useRouter();
  const [status, setStatus] = useState(recap.status);
  const [msg, setMsg] = useState<string | null>(null);
  const active = status === "PENDING" || status === "RUNNING";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try {
        const r = await api<{ recording: { recapStatus: string | null } }>(`/api/recordings/${recordingId}`);
        if (r.recording.recapStatus !== status) {
          setStatus(r.recording.recapStatus);
          router.refresh();
        }
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [active, recordingId, router, status]);

  async function rebuild() {
    setMsg(null);
    try {
      await api(`/api/recordings/${recordingId}/recap`, { method: "POST" });
      setStatus("PENDING");
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  if (!report && !status) return null;
  return (
    <section id="recap" className="card space-y-4" data-testid="game-recap">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="h2">🎬 Récap de la partie</h2>
          {report && (
            <p className="mt-1 text-xs text-muted">
              {report.moments} moment(s) analysé(s) · {report.source === "ai" ? `bilan rédigé par l'IA (${report.model ?? "Claude"})` : "bilan établi sans IA, à partir des détections"} · les propositions automatiques restent à vérifier
            </p>
          )}
        </div>
        {!active && (
          <button className="btn-ghost text-xs" onClick={rebuild} data-testid="recap-rebuild">Refaire le montage</button>
        )}
      </div>

      {report && (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="game-report">
          <div className="space-y-3 text-sm">
            <p>{report.summary}</p>
            {report.patterns.length > 0 && (
              <div>
                <p className="label">Erreurs récurrentes</p>
                <ul className="list-disc pl-5">{report.patterns.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
            <div className="rounded-lg border border-win/40 bg-win/5 p-3">
              <p className="label text-win">Objectif pour la prochaine partie</p>
              <p>{report.nextGameGoal}</p>
            </div>
          </div>
          <ol className="space-y-2 text-sm">
            {report.priorities.map((p, i) => (
              <li key={i} className="rounded-lg border border-line p-3">
                <p className="font-medium">{i + 1}. {p.title}</p>
                <p className="text-xs text-muted">{p.why}</p>
                <p className="mt-1">{p.drill}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        {active ? (
          <p className="text-sm text-accent-2" data-testid="recap-status">Montage de la vidéo récap en cours… (intro, chaque moment avec schéma et conseil, bilan)</p>
        ) : status === "READY" ? (
          <div className="space-y-2">
            <video controls preload="metadata" className="w-full rounded-lg bg-black" src={`/api/recordings/${recordingId}/recap`} data-testid="recap-video" />
            <a className="btn-ghost inline-block text-xs" href={`/api/recordings/${recordingId}/recap?download=1`}>⬇ Télécharger le récap (MP4)</a>
          </div>
        ) : status === "FAILED" ? (
          <p className="text-sm text-loss">Échec du montage : {recap.error}</p>
        ) : null}
        {msg && <p className="mt-1 text-sm text-loss">{msg}</p>}
      </div>
    </section>
  );
}
