"use client";
// Création / édition d'un moment de coaching (explication enregistrée).
import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, CONFIDENCES, CONFIDENCE_LABELS, KIND_LABELS, MOMENT_KINDS } from "@/lib/annotations/schema";
import { formatMs } from "@/lib/annotations/coaching";
import { api, errorMessage } from "@/lib/client";
import type { Alternative, RecommendationDTO } from "./types";

type Props = {
  recordingId: string;
  currentMs: () => number;
  durationMs: number;
  initial?: RecommendationDTO | null;
  onSaved: (r: RecommendationDTO) => void;
  onCancel: () => void;
};

export function MomentForm({ recordingId, currentMs, durationMs, initial, onSaved, onCancel }: Props) {
  const now = Math.round(currentMs());
  const [t, setT] = useState(() =>
    initial
      ? { contextStartMs: initial.contextStartMs, slowdownStartMs: initial.slowdownStartMs, decisionMs: initial.decisionMs, endMs: initial.endMs }
      : {
          contextStartMs: Math.max(0, now - 8000),
          slowdownStartMs: Math.max(0, now - 3000),
          decisionMs: now,
          endMs: Math.min(durationMs, now + 4000),
        },
  );
  const [kind, setKind] = useState<string>(initial?.kind ?? "MISTAKE");
  const [category, setCategory] = useState<string>(initial?.category ?? "POSITIONING");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [observations, setObservations] = useState(initial?.observations.map((o) => o.text).join("\n") ?? "");
  const [interpretation, setInterpretation] = useState(initial?.interpretation ?? "");
  const [alts, setAlts] = useState<Alternative[]>(initial?.alternatives?.length ? initial.alternatives : [{ label: "", conditions: "", limits: "" }]);
  const [confidence, setConfidence] = useState<string>(initial?.confidence ?? "MEDIUM");
  const [confidenceReason, setConfidenceReason] = useState(initial?.confidenceReason ?? "");
  const [advice, setAdvice] = useState(initial?.advice ?? "");
  const [rate, setRate] = useState(initial?.slowdownRate ?? 0.5);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const timeField = (key: keyof typeof t, label: string, help: string) => (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-panel-2 px-3 py-2">
      <div>
        <p className="text-xs font-medium">{label}</p>
        <p className="text-[11px] text-muted">{help}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm tabular-nums">{formatMs(t[key])}</span>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setT((s) => ({ ...s, [key]: Math.round(currentMs()) }))}>
          ← maintenant
        </button>
      </div>
    </div>
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        kind,
        category,
        title,
        ...t,
        slowdownRate: rate,
        observations: observations.split("\n").map((s) => s.trim()).filter(Boolean),
        interpretation,
        alternatives: alts.filter((a) => a.label.trim()),
        confidence,
        confidenceReason,
        advice,
      };
      const r = initial
        ? await api<{ recommendation: RecommendationDTO }>(`/api/recommendations/${initial.id}`, { method: "PUT", json: body })
        : await api<{ recommendation: RecommendationDTO }>(`/api/recordings/${recordingId}/recommendations`, { method: "POST", json: body });
      onSaved(r.recommendation);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm" aria-label="Moment de coaching">
      <h3 className="h2">{initial ? "Modifier le moment" : "Nouveau moment de coaching"}</h3>
      <p className="text-xs text-muted">Positionnez la vidéo puis utilisez « ← maintenant » pour chaque repère.</p>
      {timeField("contextStartMs", "Début du contexte", "Avant l'action : déplacements, alliés, infos visibles")}
      {timeField("slowdownStartMs", "Début du ralenti", "La lecture ralentit à partir d'ici")}
      {timeField("decisionMs", "Décision (pause)", "Instant où une autre décision était possible")}
      {timeField("endMs", "Fin de la séquence", "Conséquence observée")}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="m-kind">Type</label>
          <select id="m-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {MOMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="m-cat">Catégorie</label>
          <select id="m-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="m-title">Titre</label>
        <input id="m-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} placeholder="Ex. Avancée sans vision côté rivière" />
      </div>
      <div>
        <label className="label" htmlFor="m-obs">Observations (une par ligne) — uniquement ce qui est visible</label>
        <textarea id="m-obs" className="input" rows={3} value={observations} onChange={(e) => setObservations(e.target.value)} required
          placeholder={"Aucun ennemi visible sur la minimap côté bot\nAllié jungle visible en haut"} />
      </div>
      <div>
        <label className="label" htmlFor="m-int">Interprétation</label>
        <textarea id="m-int" className="input" rows={2} value={interpretation} onChange={(e) => setInterpretation(e.target.value)}
          placeholder="Pourquoi l'action était risquée ou pertinente, avec les infos disponibles À CE MOMENT" />
      </div>
      <fieldset className="space-y-2">
        <legend className="label">Alternatives (proposition, pas une certitude)</legend>
        {alts.map((a, i) => (
          <div key={i} className="space-y-1 rounded-lg border border-line p-2">
            <input className="input" aria-label={`Alternative ${i + 1}`} placeholder="Alternative" value={a.label}
              onChange={(e) => setAlts((s) => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="input" aria-label={`Conditions ${i + 1}`} placeholder="Conditions (si…)" value={a.conditions}
              onChange={(e) => setAlts((s) => s.map((x, j) => (j === i ? { ...x, conditions: e.target.value } : x)))} />
            <input className="input" aria-label={`Limites ${i + 1}`} placeholder="Limites" value={a.limits}
              onChange={(e) => setAlts((s) => s.map((x, j) => (j === i ? { ...x, limits: e.target.value } : x)))} />
          </div>
        ))}
        {alts.length < 3 && (
          <button type="button" className="text-xs text-accent-2 underline" onClick={() => setAlts((s) => [...s, { label: "", conditions: "", limits: "" }])}>
            + Ajouter une alternative
          </button>
        )}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="m-conf">Confiance</label>
          <select id="m-conf" className="input" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            {CONFIDENCES.map((c) => <option key={c} value={c}>{CONFIDENCE_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="m-rate">Ralenti</label>
          <select id="m-rate" className="input" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {[0.25, 0.5, 0.75, 1].map((r) => <option key={r} value={r}>×{r}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="m-confr">Raison du niveau de confiance</label>
        <input id="m-confr" className="input" value={confidenceReason} onChange={(e) => setConfidenceReason(e.target.value)} required maxLength={600}
          placeholder="Ex. position de l'ennemi inconnue avant 12:31" />
      </div>
      <div>
        <label className="label" htmlFor="m-adv">Conseil court et réutilisable</label>
        <input id="m-adv" className="input" value={advice} onChange={(e) => setAdvice(e.target.value)} maxLength={300}
          placeholder="Ex. Sans vision de la jungle adverse, reste derrière ta vague." />
      </div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer le moment"}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}
