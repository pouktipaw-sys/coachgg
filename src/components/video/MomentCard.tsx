"use client";
import { momentChips, momentConsequences } from "@/lib/analysis/chips";
import { Icon, type IconName } from "@/components/icons";
// Explication structurée d'un moment : 1 ce qui s'est passé · 2 pourquoi · 3 conséquences mesurées ·
// 4 ce que tu aurais dû faire · 5 le conseil ; confiance et références repliées.
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
  DEATH: "☠",
};

// Mêmes teintes que les pastilles des clips rendus (analysis/render_clip.py, CHIP_TONE).
const CHIP_COLOR = { bad: "#f87171", warn: "#fbbf24", good: "#34d399", info: "#59d5ff" } as const;

/** Couleur par type de moment (barre latérale, badge, marqueurs de la timeline). */
export const KIND_TONE: Record<RecommendationDTO["kind"], { box: string; bar: string; badge: string; dot: string }> = {
  MISTAKE: { box: "border-magenta/35 bg-magenta/[0.06]", bar: "bg-magenta", badge: "border-magenta/50 text-magenta", dot: "#d34aff" },
  DEATH: { box: "border-loss/35 bg-loss/[0.06]", bar: "bg-loss", badge: "border-loss/50 text-loss", dot: "#f87171" },
  MISSED_OPPORTUNITY: { box: "border-gold/35 bg-gold/[0.05]", bar: "bg-gold", badge: "border-gold/50 text-gold", dot: "#fbbf24" },
  GOOD_ACTION: { box: "border-win/35 bg-win/[0.05]", bar: "bg-win", badge: "border-win/50 text-win", dot: "#34d399" },
  OBJECTIVE: { box: "border-cyan/35 bg-cyan/[0.05]", bar: "bg-cyan", badge: "border-cyan/50 text-cyan", dot: "#59d5ff" },
  FIGHT: { box: "border-accent/35 bg-accent/[0.06]", bar: "bg-accent", badge: "border-accent/50 text-accent-2", dot: "#922eff" },
  INTERESTING: { box: "border-line bg-panel-2/60", bar: "bg-accent-2", badge: "border-line text-muted", dot: "#c48bff" },
};

function Step({ n, icon, title, accent = "accent", children }: { n: number; icon: IconName; title: string; accent?: "accent" | "loss" | "win"; children: React.ReactNode }) {
  const c = { accent: "text-accent-2 border-accent/30 bg-accent/10", loss: "text-loss border-loss/30 bg-loss/10", win: "text-win border-win/30 bg-win/10" }[accent];
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        <span aria-hidden className={`grid h-6 w-6 place-items-center rounded-md border ${c}`}><Icon name={icon} size={13} /></span>
        {n} · {title}
      </h4>
      {children}
    </section>
  );
}

export function MomentCard({
  m,
  recordingId,
  gameOffsetMs,
  onReplay,
  onContinue,
  onSeek,
  canReport,
  isOwner = false,
  onReviewed,
}: {
  m: RecommendationDTO;
  recordingId: string;
  gameOffsetMs: number | null;
  onReplay?: () => void;
  onContinue?: () => void;
  onSeek?: (ms: number) => void;
  canReport: boolean;
  isOwner?: boolean;
  onReviewed?: (r: RecommendationDTO | null) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const g = gameTimeMs(m.decisionMs, gameOffsetMs);
  const isAuto = m.provenance === "AUTOMATIC";
  const pending = isAuto && m.status === "DRAFT";

  async function review(action: "validate" | "reject", comment?: string) {
    try {
      const r = await api<{ recommendation: RecommendationDTO }>(`/api/recommendations/${m.id}/review`, { method: "POST", json: { action, comment } });
      setMsg(action === "validate" ? "Proposition validée : elle est désormais un moment publié." : "Proposition rejetée (conservée pour mesurer la précision de l'analyse).");
      onReviewed?.(action === "validate" ? { ...m, status: r.recommendation.status } : null);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  async function report(kind: "INCORRECT" | "UNCLEAR" | "HELPFUL", comment?: string) {
    try {
      await api("/api/feedback", { method: "POST", json: { recommendationId: m.id, kind, comment } });
      setMsg(kind === "HELPFUL" ? "Merci pour votre retour." : "Signalement enregistré. Le moment est marqué comme contesté.");
      setReporting(false);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  const chips = momentChips(m.autoEvidence);
  const consequences = momentConsequences(m.autoEvidence);
  const tone = KIND_TONE[m.kind];
  const why =
    m.kind === "GOOD_ACTION" ? "Pourquoi c'est une bonne décision" : m.kind === "MISTAKE" || m.kind === "MISSED_OPPORTUNITY" ? "Pourquoi c'est une erreur" : "Ce que ça veut dire";
  return (
    <article className="space-y-4 text-sm" aria-label={`Moment : ${m.title}`} data-testid="moment-card">
      <header className={`relative overflow-hidden rounded-xl border p-3.5 ${tone.box}`}>
        <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className={`badge ${tone.badge}`}>{KIND_ICON[m.kind]} {KIND_LABELS[m.kind]}</span>
          <span className="badge border-line text-muted">{CATEGORY_LABELS[m.category as keyof typeof CATEGORY_LABELS] ?? m.category}</span>
          <span className={`badge ${CONF_TONE[m.confidence]}`}>{CONFIDENCE_LABELS[m.confidence]}</span>
          {m.status === "DISPUTED" && <span className="badge border-warn/40 text-warn">Contesté</span>}
          {isAuto && (
            <span className="badge border-accent/40 bg-accent/10 text-accent-2" data-testid="auto-badge">
              {pending ? "Proposition automatique — à valider" : `Automatique, validée${m.humanEdited ? " et corrigée" : ""}`}
            </span>
          )}
        </div>
        <h3 className="mt-2 font-display text-lg font-bold leading-snug">{m.title}</h3>
        <p className="mt-0.5 text-xs text-muted">
          <button className="font-display text-accent-2 hover:underline" onClick={() => onSeek?.(m.decisionMs)}>{formatMs(m.decisionMs)}</button>
          {g != null && ` · ${formatMs(g)} en jeu`}
        </p>
        {chips.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5" data-testid="moment-chips" aria-label="Faits mesurés">
            {chips.map((c) => (
              <li key={c.text} className="rounded-full border px-2.5 py-0.5 text-xs font-medium" style={{ borderColor: `${CHIP_COLOR[c.tone]}88`, color: CHIP_COLOR[c.tone], background: `${CHIP_COLOR[c.tone]}14` }}>
                {c.text}
              </li>
            ))}
          </ul>
        )}
      </header>

      {pending && isOwner && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs" data-testid="review-box">
          <p className="text-warn">
            Proposition générée par des règles automatiques ({m.analysisVersion}) à partir de signaux mesurés dans l&apos;image.
            Elle peut être fausse. Toi seul la vois tant qu&apos;elle n&apos;est pas validée.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => review("validate")}>Valider</button>
            <button
              className="btn-danger px-2.5 py-1 text-xs"
              onClick={() => {
                const c = prompt("Pourquoi rejeter cette proposition ? (facultatif)") ?? undefined;
                void review("reject", c || undefined);
              }}
            >
              Rejeter
            </button>
          </div>
          <p className="mt-1 text-muted">Pour ajuster l&apos;instant de décision ou le texte, utilise « Modifier » puis valide.</p>
        </div>
      )}

      {m.contextSheetKey && (
        <section>
          <h4 className="label">Contexte avant l&apos;événement</h4>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/recommendations/${m.id}/sheet`} alt="Planche de 8 images précédant l'événement" className="w-full rounded-xl border border-line" loading="lazy" />
        </section>
      )}

      <Step n={1} icon="eye" title={`Ce qui s'est passé${isAuto ? " (mesuré automatiquement)" : ""}`}>
        <ul className="space-y-1.5">
          {m.observations.map((o) => (
            <li key={o.id} className="flex gap-2"><span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent-2" />{o.text}</li>
          ))}
        </ul>
      </Step>

      {m.interpretation && (
        <Step n={2} icon="coach" title={why}>
          <p className="whitespace-pre-line text-text/80">{m.interpretation}</p>
        </Step>
      )}

      {consequences.length > 0 && (
        <Step n={3} icon="skull" title="Conséquences sur la partie (mesurées)" accent="loss">
          <ul className="space-y-1">
            {consequences.map((c) => (
              <li key={c} className="flex gap-2 text-loss/90"><span aria-hidden>▸</span>{c}</li>
            ))}
          </ul>
        </Step>
      )}

      {m.alternatives.length > 0 && (
        <Step n={4} icon="target" title={m.kind === "GOOD_ACTION" ? "Pour aller plus loin" : "Ce que tu aurais dû faire"} accent="win">
          <ul className="space-y-2">
            {m.alternatives.map((a, i) => (
              <li key={i} className="rounded-xl border border-win/25 bg-win/[0.06] p-2.5">
                <p className="font-medium text-win">↗ {a.label}</p>
                {a.conditions && <p className="mt-1 text-xs text-muted"><strong>Si :</strong> {a.conditions}</p>}
                {a.limits && <p className="mt-0.5 text-xs text-muted"><strong>Limites :</strong> {a.limits}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted">
            Une alternative est une proposition, pas une simulation : rien ne garantit l&apos;issue qu&apos;elle aurait eue.
          </p>
        </Step>
      )}

      {m.advice && (
        <section className="relative overflow-hidden rounded-xl border border-accent/40 bg-gradient-to-br from-accent/20 via-magenta/10 to-transparent p-3.5 shadow-[0_0_30px_-12px_rgb(146_46_255/0.8)]">
          <h4 className="label flex items-center gap-1.5 text-accent-2"><Icon name="bolt" size={13} /> 5 · Le conseil pour progresser</h4>
          <p className="font-display text-[15px] font-semibold leading-snug">{m.advice}</p>
        </section>
      )}

      <details className="rounded-xl border border-line/70 bg-bg/30 px-3 py-2 text-xs text-muted">
        <summary className="cursor-pointer select-none text-text/80">Confiance et références</summary>
        <p className="mt-2"><span className="font-medium text-text">Confiance : {CONFIDENCE_LABELS[m.confidence]}</span> — {m.confidenceReason}</p>
        <p className="mt-1">
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
        {isAuto && m.autoEvidence && (
          <details className="mt-1">
            <summary className="cursor-pointer">Mesures brutes</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-panel-2 p-2 text-[10px]">{JSON.stringify(m.autoEvidence, null, 2)}</pre>
          </details>
        )}
      </details>

      {(onReplay || onContinue) && (
        <div className="flex flex-wrap gap-2">
          {onReplay && <button className="btn-ghost" onClick={onReplay}>↺ Revoir la séquence</button>}
          {m.status !== "DRAFT" && (
            <button
              className="btn-ghost"
              data-testid="moment-to-clip"
              onClick={async () => {
                try {
                  await api(`/api/recommendations/${m.id}/clip`, { method: "POST", json: {} });
                  setMsg("Ajouté à vos clips.");
                } catch (e) {
                  setMsg(errorMessage(e));
                }
              }}
            >
              ✂ Ajouter à mes clips
            </button>
          )}
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
