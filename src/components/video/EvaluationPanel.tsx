"use client";
// Mesure de la précision de l'analyse assistée sur CETTE vidéo :
// le propriétaire marque les morts réelles (ou les importe de la timeline Riot),
// puis compare avec les détections automatiques.
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client";
import { formatMs } from "@/lib/annotations/coaching";

type Truth = { id: string; videoMs: number; source: "MANUAL" | "RIOT_TIMELINE" };
type Evaluation =
  | {
      status: "ok";
      version: string;
      truthSource: "RIOT_TIMELINE" | "MANUAL";
      truthCount: number;
      toleranceMs: number;
      result: { tp: number; fp: number; fn: number; precision: number | null; recall: number | null; f1: number | null; meanOffsetMs: number | null; falsePositives: number[]; missed: number[] };
    }
  | { status: string; message: string };

const video = () => document.querySelector<HTMLVideoElement>("[data-testid=video]");
const seek = (ms: number) => {
  const v = video();
  if (v) {
    v.pause();
    v.currentTime = ms / 1000;
  }
};
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)} %`);

export function EvaluationPanel({ recordingId, riotReady }: { recordingId: string; riotReady: { ok: boolean; reason?: string } }) {
  const [truths, setTruths] = useState<Truth[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [t, e] = await Promise.all([
      api<{ events: Truth[] }>(`/api/recordings/${recordingId}/ground-truth`),
      api<{ evaluation: Evaluation }>(`/api/recordings/${recordingId}/evaluation`),
    ]);
    setTruths(t.events);
    setEvaluation(e.evaluation);
  }, [recordingId]);

  useEffect(() => {
    reload().catch((e) => setMsg(errorMessage(e)));
  }, [reload]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  const ev = evaluation?.status === "ok" ? (evaluation as Extract<Evaluation, { status: "ok" }>) : null;

  return (
    <section className="card space-y-3" aria-label="Mesurer la précision" data-testid="evaluation-panel">
      <div>
        <h2 className="h2">Mesurer la précision de l&apos;analyse</h2>
        <p className="mt-1 text-xs text-muted">
          Marquez chaque mort réelle de cette vidéo (pause sur l&apos;instant de la mort, puis bouton), ou importez-les depuis la timeline Riot.
          CoachGG compare ensuite avec les écrans grisés détectés. Ces marques servent uniquement à l&apos;évaluation.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          data-testid="mark-death"
          onClick={() => run(() => api(`/api/recordings/${recordingId}/ground-truth`, { method: "POST", json: { videoMs: Math.round((video()?.currentTime ?? 0) * 1000) } }), "Mort marquée.")}
        >
          ☠ Marquer une mort à l&apos;instant affiché
        </button>
        <button
          className="btn-ghost"
          disabled={!riotReady.ok}
          title={riotReady.reason}
          onClick={() => run(async () => {
            const r = await api<{ imported: number }>(`/api/recordings/${recordingId}/ground-truth/riot`, { method: "POST", json: {} });
            setMsg(`${r.imported} mort(s) importée(s) depuis la timeline Riot.`);
          })}
        >
          Importer les morts (timeline Riot)
        </button>
      </div>
      {!riotReady.ok && <p className="text-xs text-muted">Import Riot indisponible : {riotReady.reason}</p>}
      {msg && <p role="status" className="text-xs text-muted">{msg}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="label">Morts réelles ({truths.length})</h3>
          {truths.length === 0 ? (
            <p className="text-sm text-muted">Aucune.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-auto text-sm" data-testid="truth-list">
              {truths.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded bg-panel-2 px-2 py-1">
                  <button className="font-mono underline" onClick={() => seek(t.videoMs)}>{formatMs(t.videoMs)}</button>
                  <span className="flex-1 text-xs text-muted">{t.source === "RIOT_TIMELINE" ? "timeline Riot" : "marquée à la main"}</span>
                  {t.source === "MANUAL" && (
                    <button className="text-xs text-loss" aria-label="Retirer" onClick={() => run(() => api(`/api/ground-truth/${t.id}`, { method: "DELETE" }))}>✕</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div data-testid="evaluation-result">
          <h3 className="label">Résultat</h3>
          {!evaluation ? (
            <p className="text-sm text-muted">Chargement…</p>
          ) : ev ? (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Metric label="Précision" value={pct(ev.result.precision)} hint="détections correctes / détections" />
                <Metric label="Rappel" value={pct(ev.result.recall)} hint="morts retrouvées / morts réelles" />
                <Metric label="F1" value={pct(ev.result.f1)} hint="moyenne harmonique" />
              </div>
              <p className="text-xs text-muted">
                {ev.result.tp} correcte(s) · {ev.result.fp} fausse(s) alerte(s) · {ev.result.fn} mort(s) manquée(s)
                {ev.result.meanOffsetMs != null && ` · décalage moyen ${(ev.result.meanOffsetMs / 1000).toFixed(1)} s`}
              </p>
              {ev.result.missed.length > 0 && (
                <p className="text-xs">Manquées : {ev.result.missed.map((m) => <button key={m} className="mr-1 font-mono underline" onClick={() => seek(m)}>{formatMs(m)}</button>)}</p>
              )}
              {ev.result.falsePositives.length > 0 && (
                <p className="text-xs">Fausses alertes : {ev.result.falsePositives.map((m) => <button key={m} className="mr-1 font-mono underline" onClick={() => seek(m)}>{formatMs(m)}</button>)}</p>
              )}
              <p className="text-xs text-muted">
                Règles {ev.version} · référence : {ev.truthSource === "RIOT_TIMELINE" ? "timeline Riot" : "marquage manuel"} ({ev.truthCount}) · tolérance ±{ev.toleranceMs / 1000} s.
                Une seule vidéo ne suffit pas à juger la qualité générale.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">{(evaluation as { message: string }).message}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg bg-panel-2 p-2" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
