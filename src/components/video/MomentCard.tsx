"use client";
// Explication structurée d'un moment : Observations / Interprétation /
// Alternatives / Confiance / Conseil / Références.
import { useState } from "react";
import { CATEGORY_LABELS, CONFIDENCE_LABELS, KIND_LABELS } from "@/lib/annotations/schema";
import { formatMs, gameTimeMs } from "@/lib/annotations/coaching";
import { api, errorMessage } from "@/lib/client";
import type { RecommendationDTO } from "./types";

const CONF_TONE: Record<RecommendationDTO["confidence"], string> = {
  HIGH: "text-win border-win/40",
  MEDIUM: "text-accent-2 border-accent/40",
  LOW: "text-warn border-warn/40",
  INCONCLUSIVE: "text-muted border-line",
};

export const KIND_ICON: Record<RecommendationDTO["kind"], string> = {
  MISTAKE: "△",
  GOOD_ACTION: "✓",
  OBJECTIVE: "◆",
  FIGHT: "⚔",
  MISSED_OPPORTUNITY: "○",
  INTERESTING: "★",
};

export function MomentCard({
  m,
  recordingId,
  gameOffsetMs,
  onReplay,
  onContinue,
  onSeek,
  canReport,
}: {
  m: RecommendationDTO;
  recordingId: string;
  gameOffsetMs: number | null;
  onReplay?: () => void;
  onContinue?: () => void;
  onSeek?: (ms: number) => void;
  canReport: boolean;
}) {
  const [reporting, setReporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const g = gameTimeMs(m.decisionMs, gameOffsetMs);

  async function report(kind: "INCORRECT" | "UNCLEAR" | "HELPFUL", comment?: string) {
    try {
      await api("/api/feedback", { method: "POST", json: { recommendationId: m.id, kind, comment } });
      setMsg(kind === "HELPFUL" ? "Merci pour votre retour." : "Signalement enregistré. Le moment est marqué comme contesté.");
      setReporting(false);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  return (
    <article className="space-y-4 text-sm" aria-label={`Moment : ${m.title}`} data-testid="moment-card">
      <header>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="badge border-line text-muted">{KIND_ICON[m.kind]} {KIND_LABELS[m.kind]}</span>
          <span className="badge border-line text-muted">{CATEGORY_LABELS[m.category as keyof typeof CATEGORY_LABELS] ?? m.category}</span>
          <span className={`badge ${CONF_TONE[m.confidence]}`}>{CONFIDENCE_LABELS[m.confidence]}</span>
          {m.status === "DISPUTED" && <span className="badge border-warn/40 text-warn">Contesté</span>}
        </div>
        <h3 className="mt-2 text-base font-semibold">{m.title}</h3>
      </header>

      <section>
        <h4 className="label">1 · Observations</h4>
        <ul className="list-disc space-y-1 pl-5">
          {m.observations.map((o) => (
            <li key={o.id}>{o.text}</li>
          ))}
        </ul>
      </section>

      {m.interpretation && (
        <section>
          <h4 className="label">2 · Interprétation</h4>
          <p className="whitespace-pre-line text-muted">{m.interpretation}</p>
        </section>
      )}

      {m.alternatives.length > 0 && (
        <section>
          <h4 className="label">3 · Alternatives proposées</h4>
          <ul className="space-y-2">
            {m.alternatives.map((a, i) => (
              <li key={i} className="rounded-lg border border-win/25 bg-win/5 p-2.5">
                <p className="font-medium text-win">↗ {a.label}</p>
                {a.conditions && <p className="mt-1 text-xs text-muted"><strong>Si :</strong> {a.conditions}</p>}
                {a.limits && <p className="mt-0.5 text-xs text-muted"><strong>Limites :</strong> {a.limits}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">
            Une alternative est une proposition, pas une simulation : rien ne garantit l&apos;issue qu&apos;elle aurait eue.
          </p>
        </section>
      )}

      <section>
        <h4 className="label">4 · Confiance</h4>
        <p><span className="font-medium">{CONFIDENCE_LABELS[m.confidence]}</span> — <span className="text-muted">{m.confidenceReason}</span></p>
      </section>

      {m.advice && (
        <section className="rounded-lg border border-accent/30 bg-accent/10 p-3">
          <h4 className="label text-accent-2">5 · Conseil</h4>
          <p className="font-medium">{m.advice}</p>
        </section>
      )}

      <section className="text-xs text-muted">
        <h4 className="label">6 · Références</h4>
        <p>
          Vidéo{" "}
          <button className="underline" onClick={() => onSeek?.(m.contextStartMs)}>{formatMs(m.contextStartMs)}</button>
          {" → décision "}
          <button className="underline" onClick={() => onSeek?.(m.decisionMs)}>{formatMs(m.decisionMs)}</button>
          {" → "}
          {formatMs(m.endMs)}
          {g != null && ` · temps de jeu ${formatMs(g)}`}
        </p>
        <p>
          {m.provenance === "MANUAL" ? "Annoté manuellement" : "Analyse automatique"} · version {m.analysisVersion} · réf. {recordingId.slice(-6)}/{m.id.slice(-6)}
        </p>
      </section>

      {(onReplay || onContinue) && (
        <div className="flex flex-wrap gap-2">
          {onReplay && <button className="btn-ghost" onClick={onReplay}>↺ Revoir la séquence</button>}
          {onContinue && <button className="btn-primary" onClick={onContinue}>Continuer ▶</button>}
        </div>
      )}

      {canReport && (
        <div className="border-t border-line pt-3 text-xs">
          {msg && <p className="mb-2 text-muted" role="status">{msg}</p>}
          {!reporting ? (
            <div className="flex flex-wrap gap-3 text-muted">
              <button className="underline hover:text-text" onClick={() => report("HELPFUL")}>Utile</button>
              <button className="underline hover:text-text" onClick={() => setReporting(true)}>Signaler un diagnostic incorrect</button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const c = new FormData(e.currentTarget).get("comment") as string;
                void report("INCORRECT", c);
              }}
              className="space-y-2"
            >
              <textarea name="comment" className="input" rows={2} placeholder="Qu'est-ce qui est inexact ?" maxLength={1000} />
              <div className="flex gap-2">
                <button className="btn-danger">Envoyer le signalement</button>
                <button type="button" className="btn-ghost" onClick={() => setReporting(false)}>Annuler</button>
              </div>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
