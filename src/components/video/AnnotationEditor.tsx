"use client";
// Éditeur simple d'annotations manuelles.
import {
  ANNOTATION_STYLES,
  ANNOTATION_TYPES,
  STYLE_META,
  TYPE_META,
  type AnnotationInput,
  type AnnotationStyle,
  type AnnotationType,
  type CoordinateSpace,
  type Point,
} from "@/lib/annotations/schema";
import { subRect, type Rect } from "@/lib/annotations/geometry";
import { formatMs } from "@/lib/annotations/coaching";
import type { AnnotationDTO, RecommendationDTO } from "./types";

export type Draft = {
  type: AnnotationType | "minimap";
  style: AnnotationStyle;
  space: CoordinateSpace;
  points: Point[];
  durationMs: number;
  label: string;
  recommendationId: string;
};

export const emptyDraft = (): Draft => ({
  type: "path",
  style: "actual",
  space: "FRAME",
  points: [],
  durationMs: 4000,
  label: "",
  recommendationId: "",
});

export function requiredPoints(d: Draft): number {
  if (d.type === "minimap") return 2;
  const p = TYPE_META[d.type].points;
  return p === "many" ? Infinity : p;
}

/** Construit l'annotation à partir des clics. r est normalisé à la largeur de l'espace. */
export function buildAnnotation(d: Draft, startMs: number, frame: Rect, minimap: Rect | null): AnnotationInput | null {
  if (d.type === "minimap") return null;
  const space = d.space;
  const target = space === "MINIMAP" && minimap ? subRect(frame, minimap) : frame;
  const [a, b] = d.points;
  const radius = () => {
    if (!a || !b) return 0;
    const dx = (b.x - a.x) * target.w;
    const dy = (b.y - a.y) * target.h;
    return Math.min(0.5, Math.max(0.005, Math.hypot(dx, dy) / Math.max(1, target.w)));
  };
  const base = {
    startMs: Math.round(startMs),
    endMs: Math.round(startMs + d.durationMs),
    space,
    style: d.style,
    label: d.label.trim() || null,
    recommendationId: d.recommendationId || null,
  };
  switch (d.type) {
    case "path":
      return d.points.length >= 2 ? { ...base, type: "path", geometry: { points: d.points } } : null;
    case "arrow":
      return a && b ? { ...base, type: "arrow", geometry: { from: a, to: b } } : null;
    case "zone":
      return a && b ? { ...base, type: "zone", geometry: { center: a, r: radius() } } : null;
    case "highlight":
      return a && b ? { ...base, type: "highlight", geometry: { at: a, r: radius() } } : null;
    case "marker":
      return a ? { ...base, type: "marker", geometry: { at: a } } : null;
    case "click":
      return a ? { ...base, type: "click", geometry: { at: a } } : null;
    case "text":
      return a && d.label.trim() ? { ...base, type: "text", geometry: { at: a } } : null;
  }
}

type Props = {
  draft: Draft;
  setDraft: (d: Draft) => void;
  hasMinimap: boolean;
  moments: RecommendationDTO[];
  annotations: AnnotationDTO[];
  canSave: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onDelete: (id: string) => void;
  onSetBound: (id: string, which: "startMs" | "endMs") => void;
  onSeek: (ms: number) => void;
  tMs: number;
};

export function AnnotationEditor(p: Props) {
  const { draft, setDraft } = p;
  const need = requiredPoints(draft);
  const hint = draft.type === "minimap" ? "Cliquez le coin haut-gauche puis le coin bas-droit de la minimap dans la vidéo." : TYPE_META[draft.type].hint;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="h2">Annoter à {formatMs(p.tMs)}</h3>
        <p className="mt-1 text-xs text-muted">
          Mettez la vidéo en pause, choisissez un outil puis cliquez sur l&apos;image. Les annotations « image » sont en
          coordonnées écran : elles ne suivent pas la caméra. Pour une trajectoire longue, utilisez l&apos;espace minimap.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="a-type">Outil</label>
          <select id="a-type" className="input" value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"], points: [] })}>
            {ANNOTATION_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
            <option value="minimap">⌗ Définir la zone minimap</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="a-style">Style</label>
          <select id="a-style" className="input" value={draft.style} disabled={draft.type === "minimap"}
            onChange={(e) => setDraft({ ...draft, style: e.target.value as AnnotationStyle })}>
            {ANNOTATION_STYLES.map((s) => <option key={s} value={s}>{STYLE_META[s].label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="a-space">Espace</label>
          <select id="a-space" className="input" value={draft.space} disabled={draft.type === "minimap"}
            onChange={(e) => setDraft({ ...draft, space: e.target.value as CoordinateSpace, points: [] })}>
            <option value="FRAME">Image (écran)</option>
            <option value="MINIMAP" disabled={!p.hasMinimap}>Minimap{p.hasMinimap ? "" : " (à définir)"}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="a-dur">Durée</label>
          <select id="a-dur" className="input" value={draft.durationMs} disabled={draft.type === "minimap"}
            onChange={(e) => setDraft({ ...draft, durationMs: Number(e.target.value) })}>
            {[1500, 2500, 4000, 6000, 10000, 15000].map((d) => <option key={d} value={d}>{d / 1000} s</option>)}
          </select>
        </div>
      </div>
      {draft.type !== "minimap" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="a-label">Texte court</label>
            <input id="a-label" className="input" maxLength={80} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="optionnel" />
          </div>
          <div>
            <label className="label" htmlFor="a-rec">Lier au moment</label>
            <select id="a-rec" className="input" value={draft.recommendationId} onChange={(e) => setDraft({ ...draft, recommendationId: e.target.value })}>
              <option value="">— aucun —</option>
              {p.moments.map((m) => <option key={m.id} value={m.id}>{formatMs(m.decisionMs)} · {m.title}</option>)}
            </select>
          </div>
        </div>
      )}
      <p className="rounded-lg bg-panel-2 p-2 text-xs" aria-live="polite">
        {hint} — points : {draft.points.length}{Number.isFinite(need) ? ` / ${need}` : " (2 minimum)"}
      </p>
      {p.error && <p role="alert" className="text-sm text-loss">{p.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={!p.canSave || p.busy} onClick={p.onSave}>
          {draft.type === "minimap" ? "Enregistrer la zone minimap" : "Enregistrer l'annotation"}
        </button>
        <button className="btn-ghost" disabled={draft.points.length === 0} onClick={() => setDraft({ ...draft, points: draft.points.slice(0, -1) })}>
          Annuler le dernier point
        </button>
        <button className="btn-ghost" disabled={draft.points.length === 0} onClick={() => setDraft({ ...draft, points: [] })}>Effacer</button>
      </div>

      <div>
        <h4 className="label">Annotations ({p.annotations.length})</h4>
        {p.annotations.length === 0 ? (
          <p className="text-xs text-muted">Aucune annotation.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-auto pr-1">
            {p.annotations.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg bg-panel-2 px-2 py-1.5 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STYLE_META[a.style].color }} aria-hidden />
                <button className="flex-1 truncate text-left hover:underline" onClick={() => p.onSeek(a.startMs)}>
                  {formatMs(a.startMs)}–{formatMs(a.endMs)} · {TYPE_META[a.type].label} · {a.label || STYLE_META[a.style].label}
                  {a.space === "MINIMAP" ? " · minimap" : ""}
                </button>
                <button className="text-muted hover:text-text" title="Début = temps actuel" onClick={() => p.onSetBound(a.id, "startMs")}>⇤</button>
                <button className="text-muted hover:text-text" title="Fin = temps actuel" onClick={() => p.onSetBound(a.id, "endMs")}>⇥</button>
                <button className="text-loss" title="Supprimer" aria-label="Supprimer l'annotation" onClick={() => p.onDelete(a.id)}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
