"use client";
// Rendu SVG des annotations, synchronisé sur le temps vidéo.
// Toutes les positions sont recalculées à partir du rectangle réel de la vidéo
// (letterbox géré) → correct au redimensionnement et en plein écran.
// Chaque style combine couleur + forme + libellé (pas de dépendance à la couleur seule).
import { STYLE_META, type AnnotationStyle } from "@/lib/annotations/schema";
import {
  drawProgress,
  fadeOpacity,
  pointAlong,
  polylineLength,
  projectPoint,
  projectRadius,
  subRect,
  type Rect,
} from "@/lib/annotations/geometry";
import type { AnnotationDTO } from "./types";

type Props = {
  annotations: AnnotationDTO[];
  tMs: number;
  frame: Rect;
  minimap: Rect | null;
  width: number;
  height: number;
  /** Pendant la pause pédagogique : les annotations du moment s'animent sur une horloge locale. */
  pauseAnim?: { momentId: string; elapsedMs: number; decisionMs: number } | null;
  showMinimapFrame?: boolean;
  draft?: React.ReactNode;
};

export function AnnotationOverlay({ annotations, tMs, frame, minimap, width, height, pauseAnim, showMinimapFrame, draft }: Props) {
  const mm = minimap ? subRect(frame, minimap) : null;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
      aria-hidden="true"
      data-testid="annotation-overlay"
    >
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#ff8a4c" strokeWidth="3" strokeOpacity="0.55" />
        </pattern>
        {(["actual", "alternative", "neutral", "ally", "enemy", "danger"] as AnnotationStyle[]).map((s) => (
          <marker key={s} id={`arrow-${s}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={STYLE_META[s].color} />
          </marker>
        ))}
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="#000" floodOpacity="0.9" />
        </filter>
      </defs>
      {showMinimapFrame && mm && (
        <rect x={mm.x} y={mm.y} width={mm.w} height={mm.h} fill="none" stroke="#7cc4ff" strokeDasharray="6 4" strokeWidth={1.5} />
      )}
      {annotations.map((a) => {
        const inPause = pauseAnim && a.recommendationId === pauseAnim.momentId && a.startMs <= pauseAnim.decisionMs + 50 && a.endMs >= pauseAnim.decisionMs - 50;
        let progress: number;
        let opacity: number;
        if (inPause) {
          // Pause : la trajectoire réelle reste visible ; l'alternative se dessine.
          progress = a.style === "alternative" ? Math.min(1, pauseAnim!.elapsedMs / 1800) : 1;
          opacity = 1;
        } else {
          opacity = fadeOpacity(a, tMs);
          if (opacity <= 0) return null;
          progress = drawProgress(a, tMs);
        }
        return (
          <g key={a.id} opacity={opacity} filter="url(#shadow)" data-annotation-id={a.id} data-annotation-type={a.type}>
            <Shape a={a} progress={progress} frame={frame} minimap={minimap} />
          </g>
        );
      })}
      {draft}
    </svg>
  );
}

function Tag({ x, y, text, color, anchor = "start" }: { x: number; y: number; text: string; color: string; anchor?: "start" | "middle" | "end" }) {
  const w = text.length * 6.6 + 12;
  const rx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  return (
    <g>
      <rect x={rx} y={y - 11} width={w} height={18} rx={4} fill="#0a0d14" fillOpacity={0.85} stroke={color} strokeWidth={1} />
      <text x={rx + 6} y={y + 2} fontSize={11} fontWeight={600} fill="#fff" style={{ fontFamily: "var(--font-sans)" }}>
        {text}
      </text>
    </g>
  );
}

export function Shape({ a, progress, frame, minimap }: { a: AnnotationDTO; progress: number; frame: Rect; minimap: Rect | null }) {
  const meta = STYLE_META[a.style];
  const color = meta.color;
  const P = (p: { x: number; y: number }) => projectPoint(p, a.space, frame, minimap);
  const R = (r: number) => projectRadius(r, a.space, frame, minimap);
  const small = a.space === "MINIMAP";
  const stroke = small ? 2.2 : 4;
  const label = a.label || defaultLabel(a);

  switch (a.type) {
    case "path": {
      const pts = a.geometry.points.map(P);
      const len = polylineLength(pts);
      const head = pointAlong(pts, progress);
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const dashed = a.style === "alternative";
      const start = pts[0]!;
      return (
        <g>
          {/* contour noir pour la lisibilité sur n'importe quel fond */}
          <path d={d} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={stroke + 3} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={`${len * progress} ${len + 1}`} />
          {dashed ? (
            // pointillés révélés progressivement via un masque de longueur
            <g>
              <mask id={`m-${a.id}`} maskUnits="userSpaceOnUse">
                <path d={d} fill="none" stroke="#fff" strokeWidth={stroke + 6} strokeDasharray={`${len * progress} ${len + 1}`} strokeLinecap="round" />
              </mask>
              <path d={d} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={meta.dash} strokeLinecap="round" strokeLinejoin="round" mask={`url(#m-${a.id})`} />
            </g>
          ) : (
            <path d={d} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${len * progress} ${len + 1}`} />
          )}
          <circle cx={start.x} cy={start.y} r={small ? 3 : 5} fill={color} />
          {progress > 0 &&
            (a.style === "actual" ? (
              <g transform={`translate(${head.x},${head.y})`}>
                <circle r={small ? 5 : 8} fill="#0a0d14" stroke={color} strokeWidth={2} />
                <path d={small ? "M-2.5,-2.5 L2.5,2.5 M2.5,-2.5 L-2.5,2.5" : "M-4,-4 L4,4 M4,-4 L-4,4"} stroke={color} strokeWidth={2.2} />
              </g>
            ) : (
              <g transform={`translate(${head.x},${head.y})`}>
                <circle r={small ? 5 : 8} fill="#0a0d14" stroke={color} strokeWidth={2} />
                <path d={small ? "M-2.5,0 L-0.5,2 L3,-2.5" : "M-4,0 L-1,3.5 L4.5,-3.5"} fill="none" stroke={color} strokeWidth={2.2} />
              </g>
            ))}
          {progress >= 1 && !small && <Tag x={head.x + 12} y={head.y - 12} text={label} color={color} />}
          {progress >= 1 && small && <Tag x={head.x + 8} y={head.y - 8} text={a.style === "alternative" ? "Alt." : "Réel"} color={color} />}
        </g>
      );
    }
    case "arrow": {
      const f = P(a.geometry.from);
      const t0 = P(a.geometry.to);
      const t = { x: f.x + (t0.x - f.x) * progress, y: f.y + (t0.y - f.y) * progress };
      return (
        <g>
          <line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke={color} strokeWidth={stroke} strokeDasharray={meta.dash} markerEnd={`url(#arrow-${a.style})`} strokeLinecap="round" />
          {progress >= 1 && label && <Tag x={t.x + 10} y={t.y - 10} text={label} color={color} />}
        </g>
      );
    }
    case "zone": {
      const c = P(a.geometry.center);
      const r = R(a.geometry.r) * Math.min(1, 0.3 + progress);
      return (
        <g>
          <circle cx={c.x} cy={c.y} r={r} fill={a.style === "danger" ? "url(#hatch)" : color} fillOpacity={a.style === "danger" ? 1 : 0.15} stroke={color} strokeWidth={2} strokeDasharray="8 5" />
          {a.style === "danger" && (
            <g transform={`translate(${c.x},${c.y - r})`}>
              <path d="M0,-11 L10,7 L-10,7 z" fill="#0a0d14" stroke={color} strokeWidth={2} />
              <text x={0} y={5} textAnchor="middle" fontSize={11} fontWeight={800} fill={color}>!</text>
            </g>
          )}
          {progress >= 1 && <Tag x={c.x} y={c.y + r + 16} text={label} color={color} anchor="middle" />}
        </g>
      );
    }
    case "marker": {
      const p = P(a.geometry.at);
      const s = (small ? 6 : 11) * Math.min(1, 0.4 + progress);
      return (
        <g>
          <circle className="anim-ripple" cx={p.x} cy={p.y} r={s * 1.6} fill="none" stroke={color} strokeWidth={2} />
          <path d={`M${p.x},${p.y - s} L${p.x + s},${p.y} L${p.x},${p.y + s} L${p.x - s},${p.y} z`} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={2.5} />
          {progress >= 1 && <Tag x={p.x + s + 6} y={p.y} text={label} color={color} />}
        </g>
      );
    }
    case "highlight": {
      const p = P(a.geometry.at);
      const r = R(a.geometry.r);
      const isEnemy = a.style === "enemy";
      const isAlly = a.style === "ally";
      return (
        <g>
          <circle cx={p.x} cy={p.y} r={r} fill="none" stroke={color} strokeWidth={3} strokeDasharray={isAlly ? "2 6" : undefined}
            strokeOpacity={progress} strokeLinecap="round" />
          {isEnemy &&
            [0, 90, 180, 270].map((deg) => (
              <line key={deg} x1={p.x} y1={p.y - r - 6} x2={p.x} y2={p.y - r + 6} stroke={color} strokeWidth={3} transform={`rotate(${deg} ${p.x} ${p.y})`} />
            ))}
          {isAlly && (
            <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={`${r * 0.5} ${r * 1.5}`} strokeDashoffset={r * 0.25} />
          )}
          {progress >= 1 && <Tag x={p.x} y={p.y - r - 16} text={label} color={color} anchor="middle" />}
        </g>
      );
    }
    case "click": {
      const p = P(a.geometry.at);
      return (
        <g>
          <circle className="anim-ripple" cx={p.x} cy={p.y} r={14} fill="none" stroke={color} strokeWidth={2.5} />
          <circle cx={p.x} cy={p.y} r={4} fill={color} />
          {/* curseur stylisé */}
          <path d={`M${p.x + 6},${p.y + 6} l0,16 l4,-4 l4,8 l3,-1.5 l-4,-8 l6,0 z`} fill="#fff" stroke="#000" strokeWidth={1} />
          {progress >= 1 && <Tag x={p.x + 22} y={p.y + 14} text={a.label ? `${a.label} (conseillé)` : "Clic conseillé — non observé"} color={color} />}
        </g>
      );
    }
    case "text": {
      const p = P(a.geometry.at);
      return <Tag x={p.x} y={p.y} text={a.label ?? ""} color={color} />;
    }
  }
}

export function defaultLabel(a: Pick<AnnotationDTO, "type" | "style">): string {
  if (a.type === "marker") return "Position conseillée";
  if (a.type === "click") return "Clic conseillé";
  if (a.type === "path" && a.style === "alternative") return "Alternative (proposition)";
  if (a.type === "path" && a.style === "actual") return "Trajet réel";
  return STYLE_META[a.style].label;
}
