// Calculs géométriques et temporels purs (testés unitairement).
import type { Point } from "./schema";

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Rectangle réellement occupé par la vidéo dans son conteneur (object-fit: contain).
 * Gère les bandes noires (letterbox/pillarbox) au redimensionnement et en plein écran.
 */
export function contentRect(containerW: number, containerH: number, videoW: number, videoH: number): Rect {
  if (containerW <= 0 || containerH <= 0 || videoW <= 0 || videoH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(containerW / videoW, containerH / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h };
}

/** Projette un point normalisé d'un espace (image ou minimap) vers des pixels du rendu. */
export function projectPoint(p: Point, space: "FRAME" | "MINIMAP", frame: Rect, minimap: Rect | null): { x: number; y: number } {
  const target = space === "MINIMAP" && minimap ? subRect(frame, minimap) : frame;
  return { x: target.x + p.x * target.w, y: target.y + p.y * target.h };
}

/** Longueur en pixels du rendu pour un rayon normalisé (relatif à la largeur de l'espace). */
export function projectRadius(r: number, space: "FRAME" | "MINIMAP", frame: Rect, minimap: Rect | null): number {
  const target = space === "MINIMAP" && minimap ? subRect(frame, minimap) : frame;
  return r * target.w;
}

/** Sous-rectangle normalisé (ex. zone minimap) exprimé en pixels dans `outer`. */
export function subRect(outer: Rect, normalized: Rect): Rect {
  return {
    x: outer.x + normalized.x * outer.w,
    y: outer.y + normalized.y * outer.h,
    w: normalized.w * outer.w,
    h: normalized.h * outer.h,
  };
}

/** Inverse : pixel du rendu → point normalisé dans l'espace, ou null si hors de l'espace. */
export function unprojectPoint(px: number, py: number, space: "FRAME" | "MINIMAP", frame: Rect, minimap: Rect | null): Point | null {
  const target = space === "MINIMAP" && minimap ? subRect(frame, minimap) : frame;
  if (target.w <= 0 || target.h <= 0) return null;
  const x = (px - target.x) / target.w;
  const y = (py - target.y) / target.h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: round4(x), y: round4(y) };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function isActive(a: { startMs: number; endMs: number }, tMs: number) {
  return tMs >= a.startMs && tMs <= a.endMs;
}

/**
 * Progression de l'animation d'entrée (0→1) : la trajectoire se « dessine »
 * pendant `drawMs` (au plus 60 % de la durée), puis reste affichée.
 * Fonction pure du temps vidéo → correcte après un seek ou une pause.
 */
export function drawProgress(a: { startMs: number; endMs: number }, tMs: number, drawMs = 1500): number {
  if (tMs < a.startMs) return 0;
  const d = Math.max(1, Math.min(drawMs, (a.endMs - a.startMs) * 0.6));
  return Math.min(1, (tMs - a.startMs) / d);
}

/** Opacité : fondu de sortie sur les 300 dernières ms. */
export function fadeOpacity(a: { startMs: number; endMs: number }, tMs: number, fadeMs = 300): number {
  if (!isActive(a, tMs)) return 0;
  const left = a.endMs - tMs;
  return left >= fadeMs ? 1 : Math.max(0, left / fadeMs);
}

export function polylineLength(pts: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return len;
}

/** Point situé à la fraction `f` de la longueur d'une polyligne (tête de trajectoire). */
export function pointAlong(pts: { x: number; y: number }[], f: number): { x: number; y: number } {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1 || f <= 0) return pts[0]!;
  const total = polylineLength(pts);
  let target = Math.min(1, f) * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (target <= seg) {
      const k = seg === 0 ? 0 : target / seg;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    target -= seg;
  }
  return pts[pts.length - 1]!;
}
