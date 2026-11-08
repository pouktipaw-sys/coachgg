"use client";
// Lecteur de coaching : lecture → ralenti → pause à la décision → éléments
// importants → trajectoire réelle → alternative animée → explication → relecture.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contentRect, unprojectPoint, type Rect } from "@/lib/annotations/geometry";
import {
  crossedDecision,
  effectiveRate,
  formatMs,
  gameTimeMs,
  nextMoment,
  parseClock,
  prevMoment,
  resetSeenAfterSeek,
} from "@/lib/annotations/coaching";
import { KIND_LABELS, type AnnotationInput } from "@/lib/annotations/schema";
import { api, errorMessage } from "@/lib/client";
import { AnnotationOverlay, Shape } from "./AnnotationOverlay";
import { AnnotationEditor, buildAnnotation, emptyDraft, requiredPoints, type Draft } from "./AnnotationEditor";
import { KIND_ICON, MomentCard } from "./MomentCard";
import { MomentForm } from "./MomentForm";
import type { AnnotationDTO, RecommendationDTO, RecordingDTO } from "./types";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

type Panel = { k: "moments" } | { k: "moment"; id: string } | { k: "annotate" } | { k: "form"; edit?: RecommendationDTO } | { k: "sync" };

export function CoachingStudio({
  recording: initialRecording,
  initialMoments,
  initialAnnotations,
  isOwner,
}: {
  recording: RecordingDTO;
  initialMoments: RecommendationDTO[];
  initialAnnotations: AnnotationDTO[];
  isOwner: boolean;
}) {
  const [recording, setRecording] = useState(initialRecording);
  const [moments, setMoments] = useState(initialMoments);
  const [annotations, setAnnotations] = useState(initialAnnotations);

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [videoDims, setVideoDims] = useState({ w: recording.width ?? 1920, h: recording.height ?? 1080 });
  const [tMs, setTMs] = useState(0);
  const [durationMs, setDurationMs] = useState(recording.durationMs ?? 0);
  const [playing, setPlaying] = useState(false);
  const [userRate, setUserRate] = useState(1);
  const [coachingOn, setCoachingOn] = useState(true);
  const [showAnn, setShowAnn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [pausedAt, setPausedAt] = useState<{ momentId: string; since: number } | null>(null);
  const [pauseElapsed, setPauseElapsed] = useState(0);
  const [panel, setPanel] = useState<Panel>({ k: "moments" });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const prevMsRef = useRef(0);
  const seenRef = useRef(new Set<string>());
  const internalSeekRef = useRef(false);

  const timings = useMemo(() => moments.map((m) => ({ ...m })), [moments]);
  const frame: Rect = useMemo(() => contentRect(size.w, size.h, videoDims.w, videoDims.h), [size, videoDims]);
  const minimap = recording.minimapRegion;
  const editing = panel.k === "annotate";

  // Taille du rendu : suit le redimensionnement et le plein écran.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Boucle de synchronisation : lit currentTime à chaque frame d'affichage.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime * 1000;
        if (!v.paused && !v.seeking) {
          const hit = coachingOn ? crossedDecision(timings, prevMsRef.current, t, seenRef.current) : null;
          if (hit) {
            seenRef.current.add(hit.id);
            v.pause();
            internalSeekRef.current = true;
            v.currentTime = hit.decisionMs / 1000;
            prevMsRef.current = hit.decisionMs;
            setTMs(hit.decisionMs);
            setPausedAt({ momentId: hit.id, since: performance.now() });
            setPanel({ k: "moment", id: hit.id });
          } else {
            prevMsRef.current = t;
            setTMs(t);
            const rate = effectiveRate(timings, t, userRate, coachingOn);
            if (Math.abs(v.playbackRate - rate) > 0.001) v.playbackRate = rate;
          }
        } else {
          setTMs(t);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [timings, userRate, coachingOn]);

  // Horloge locale de l'animation pendant la pause pédagogique.
  useEffect(() => {
    if (!pausedAt) return;
    let raf = 0;
    const loop = () => {
      setPauseElapsed(performance.now() - pausedAt.since);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pausedAt]);

  const seek = useCallback(
    (ms: number) => {
      const v = videoRef.current;
      if (!v) return;
      const clamped = Math.max(0, Math.min(ms, (durationMs || v.duration * 1000) - 1));
      v.currentTime = clamped / 1000;
      prevMsRef.current = clamped;
      setTMs(clamped);
    },
    [durationMs],
  );

  function onSeeking() {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime * 1000;
    prevMsRef.current = t;
    if (internalSeekRef.current) {
      internalSeekRef.current = false;
      return;
    }
    resetSeenAfterSeek(timings, seenRef.current, t);
    setPausedAt(null);
  }

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setPausedAt(null);
      void v.play().catch(() => {});
    } else v.pause();
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shellRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const stepFrame = useCallback(
    (dir: 1 | -1) => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      seek(tMs + dir * (1000 / (recording.fps || 30)));
    },
    [seek, tMs, recording.fps],
  );

  function replay(m: RecommendationDTO) {
    seenRef.current.delete(m.id);
    setPausedAt(null);
    seek(m.contextStartMs);
    setCoachingOn(true);
    void videoRef.current?.play().catch(() => {});
  }

  function continuePlayback() {
    setPausedAt(null);
    void videoRef.current?.play().catch(() => {});
  }

  function goMoment(dir: 1 | -1) {
    const m = dir === 1 ? nextMoment(timings, tMs) : prevMoment(timings, tMs);
    if (m) {
      seenRef.current.delete(m.id);
      setPausedAt(null);
      seek(m.contextStartMs);
      setPanel({ k: "moment", id: m.id });
    }
  }

  // Raccourcis clavier (ignorés pendant la saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        " ": togglePlay,
        k: togglePlay,
        j: () => seek(tMs - 5000),
        arrowleft: () => seek(tMs - 5000),
        l: () => seek(tMs + 5000),
        arrowright: () => seek(tMs + 5000),
        ",": () => stepFrame(-1),
        ".": () => stepFrame(1),
        "[": () => goMoment(-1),
        "]": () => goMoment(1),
        a: () => setShowAnn((s) => !s),
        c: () => setCoachingOn((s) => !s),
        f: toggleFullscreen,
      };
      const fn = map[k];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ─── Édition ───
  function onStageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const space = draft.type === "minimap" ? "FRAME" : draft.space;
    const p = unprojectPoint(px, py, space, frame, minimap);
    if (!p) return;
    videoRef.current?.pause();
    const need = requiredPoints(draft);
    if (draft.points.length >= need) setDraft({ ...draft, points: [p] });
    else setDraft({ ...draft, points: [...draft.points, p] });
  }

  const draftAnnotation: AnnotationInput | null = useMemo(
    () => (editing ? buildAnnotation(draft, tMs, frame, minimap) : null),
    [editing, draft, tMs, frame, minimap],
  );

  const canSaveDraft =
    draft.type === "minimap" ? draft.points.length === 2 : draftAnnotation !== null;

  async function saveDraft() {
    setEditBusy(true);
    setEditError(null);
    try {
      if (draft.type === "minimap") {
        const [a, b] = draft.points as [{ x: number; y: number }, { x: number; y: number }];
        const region = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          w: Math.max(0.05, Math.abs(b.x - a.x)),
          h: Math.max(0.05, Math.abs(b.y - a.y)),
        };
        const r = await api<{ recording: RecordingDTO }>(`/api/recordings/${recording.id}`, { method: "PATCH", json: { minimapRegion: region } });
        setRecording((s) => ({ ...s, minimapRegion: r.recording.minimapRegion }));
        setDraft({ ...emptyDraft(), space: "MINIMAP" });
      } else if (draftAnnotation) {
        const r = await api<{ annotation: AnnotationDTO }>(`/api/recordings/${recording.id}/annotations`, { method: "POST", json: draftAnnotation });
        setAnnotations((s) => [...s, r.annotation].sort((x, y) => x.startMs - y.startMs));
        setDraft({ ...draft, points: [] });
      }
    } catch (e) {
      setEditError(errorMessage(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteAnnotation(id: string) {
    try {
      await api(`/api/annotations/${id}`, { method: "DELETE" });
      setAnnotations((s) => s.filter((a) => a.id !== id));
    } catch (e) {
      setEditError(errorMessage(e));
    }
  }

  async function setAnnotationBound(id: string, which: "startMs" | "endMs") {
    const a = annotations.find((x) => x.id === id);
    if (!a) return;
    const { id: _id, provenance: _p, schemaVersion: _s, createdAt: _c, ...rest } = a as AnnotationDTO & Record<string, unknown>;
    const body = { ...rest, [which]: Math.round(tMs) };
    try {
      const r = await api<{ annotation: AnnotationDTO }>(`/api/annotations/${id}`, { method: "PUT", json: body });
      setAnnotations((s) => s.map((x) => (x.id === id ? r.annotation : x)).sort((x, y) => x.startMs - y.startMs));
      setEditError(null);
    } catch (e) {
      setEditError(errorMessage(e));
    }
  }

  async function deleteMoment(id: string) {
    if (!confirm("Supprimer ce moment ? Les annotations liées seront conservées mais détachées.")) return;
    await api(`/api/recommendations/${id}`, { method: "DELETE" });
    setMoments((s) => s.filter((m) => m.id !== id));
    setAnnotations((s) => s.map((a) => (a.recommendationId === id ? { ...a, recommendationId: null } : a)));
    setPanel({ k: "moments" });
  }

  const activeMoment = panel.k === "moment" ? moments.find((m) => m.id === panel.id) ?? null : null;
  const pausedMoment = pausedAt ? moments.find((m) => m.id === pausedAt.momentId) ?? null : null;
  const phase = useMemo(() => {
    const m = timings.find((m) => tMs >= m.contextStartMs && tMs <= m.endMs);
    if (!m || !coachingOn) return null;
    if (pausedAt?.momentId === m.id) return { m, label: "⏸ Moment de décision" };
    if (tMs < m.slowdownStartMs) return { m, label: "Contexte avant l'action" };
    if (tMs < m.decisionMs) return { m, label: `Ralenti ×${m.slowdownRate}` };
    return { m, label: "Conséquence" };
  }, [timings, tMs, coachingOn, pausedAt]);

  const allManual = annotations.every((a) => a.provenance === "MANUAL") && moments.every((m) => m.provenance === "MANUAL");
  const gt = gameTimeMs(tMs, recording.gameStartOffsetMs);

  const draftPreview =
    editing && (draft.points.length > 0 || draftAnnotation) ? (
      <g>
        {draftAnnotation && (
          <g opacity={0.85}>
            <Shape a={{ ...draftAnnotation, id: "draft", provenance: "MANUAL", schemaVersion: 1 } as AnnotationDTO} progress={1} frame={frame} minimap={minimap} />
          </g>
        )}
        {draft.points.map((p, i) => {
          const sp = draft.type === "minimap" ? "FRAME" : draft.space;
          const target = sp === "MINIMAP" && minimap ? { x: frame.x + minimap.x * frame.w, y: frame.y + minimap.y * frame.h, w: minimap.w * frame.w, h: minimap.h * frame.h } : frame;
          return <circle key={i} cx={target.x + p.x * target.w} cy={target.y + p.y * target.h} r={4} fill="#fff" stroke="#000" />;
        })}
        {draft.type === "minimap" && draft.points.length === 2 && (() => {
          const [a, b] = draft.points as [{ x: number; y: number }, { x: number; y: number }];
          return (
            <rect x={frame.x + Math.min(a.x, b.x) * frame.w} y={frame.y + Math.min(a.y, b.y) * frame.h}
              width={Math.abs(b.x - a.x) * frame.w} height={Math.abs(b.y - a.y) * frame.h} fill="#7cc4ff22" stroke="#7cc4ff" strokeDasharray="6 4" />
          );
        })()}
      </g>
    ) : null;

  return (
    <div
      ref={shellRef}
      className={`grid gap-4 ${fullscreen ? "h-screen grid-cols-[1fr_380px] bg-bg p-3" : "xl:grid-cols-[minmax(0,1fr)_400px]"}`}
      data-testid="coaching-studio"
    >
      {/* ─── Colonne vidéo ─── */}
      <div className={`flex min-w-0 flex-col gap-2 ${fullscreen ? "h-full" : ""}`}>
        <div
          ref={stageRef}
          className={`relative overflow-hidden rounded-xl bg-black ${fullscreen ? "min-h-0 flex-1" : "aspect-video"} ${editing ? "cursor-crosshair" : ""}`}
          onClick={editing ? onStageClick : undefined}
          data-testid="video-stage"
        >
          <video
            ref={videoRef}
            src={`/api/recordings/${recording.id}/stream`}
            className="absolute inset-0 h-full w-full object-contain"
            preload="metadata"
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth) setVideoDims({ w: v.videoWidth, h: v.videoHeight });
              if (Number.isFinite(v.duration)) setDurationMs(v.duration * 1000);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeking={onSeeking}
            onError={() => setVideoError("Lecture impossible (fichier indisponible ou format non pris en charge par ce navigateur).")}
            onClick={editing ? undefined : togglePlay}
            data-testid="video"
          />
          {showAnn && (
            <AnnotationOverlay
              annotations={annotations}
              tMs={tMs}
              frame={frame}
              minimap={minimap}
              width={size.w}
              height={size.h}
              showMinimapFrame={editing}
              pauseAnim={pausedAt && pausedMoment ? { momentId: pausedAt.momentId, elapsedMs: pauseElapsed, decisionMs: pausedMoment.decisionMs } : null}
              draft={draftPreview}
            />
          )}
          {phase && (
            <div className="pointer-events-none absolute left-3 top-3 max-w-[55%] truncate rounded-md bg-black/75 px-2.5 py-1 text-xs font-medium" data-testid="coaching-phase">
              {KIND_ICON[phase.m.kind]} {phase.label} — {phase.m.title}
              {phase.m.provenance === "AUTOMATIC" && phase.m.status === "DRAFT" ? " (proposition auto)" : ""}
            </div>
          )}
          {pausedMoment && (
            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-2 rounded-lg bg-black/80 p-2.5 text-sm md:right-auto">
              <span className="font-medium">⏸ {pausedMoment.advice || pausedMoment.title}</span>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={(e) => { e.stopPropagation(); replay(pausedMoment); }}>↺ Revoir</button>
              <button className="btn-primary px-2 py-1 text-xs" onClick={(e) => { e.stopPropagation(); continuePlayback(); }}>Continuer ▶</button>
            </div>
          )}
          {videoError && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-loss">{videoError}</div>}
          <div className="pointer-events-none absolute right-3 top-3 flex gap-1">
            {(annotations.length > 0 || moments.length > 0) && allManual && (
              <span className="rounded bg-black/70 px-2 py-0.5 text-[11px] text-muted" data-testid="manual-badge">Annoté manuellement</span>
            )}
            {!allManual && (
              <span className="rounded bg-black/70 px-2 py-0.5 text-[11px] text-accent-2" data-testid="auto-overlay-badge">Contient des propositions automatiques</span>
            )}
            {recording.isDemo && <span className="rounded bg-warn/80 px-2 py-0.5 text-[11px] font-semibold text-black">DÉMO</span>}
          </div>
        </div>

        {/* Timeline + marqueurs d'événements */}
        <div className="relative px-1" aria-label="Chronologie">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(durationMs))}
            step={10}
            value={Math.round(tMs)}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
            aria-label="Position dans la vidéo"
            aria-valuetext={formatMs(tMs)}
            data-testid="timeline"
          />
          <div className="relative h-5">
            {durationMs > 0 &&
              moments.map((m) => (
                <button
                  key={m.id}
                  className="absolute -translate-x-1/2 text-xs leading-none text-accent-2 hover:text-text"
                  style={{ left: `${(m.decisionMs / durationMs) * 100}%` }}
                  title={`${formatMs(m.decisionMs)} — ${KIND_LABELS[m.kind]} : ${m.title}`}
                  aria-label={`Aller au moment ${m.title}`}
                  onClick={() => {
                    seenRef.current.delete(m.id);
                    seek(m.contextStartMs);
                    setPanel({ k: "moment", id: m.id });
                  }}
                >
                  {KIND_ICON[m.kind]}
                </button>
              ))}
          </div>
        </div>

        {/* Commandes */}
        <div className="flex flex-wrap items-center gap-2 text-sm" role="toolbar" aria-label="Commandes du lecteur">
          <button className="btn-ghost min-w-28 whitespace-nowrap" onClick={togglePlay} aria-label={playing ? "Pause" : "Lecture"} data-testid="play-toggle">
            {playing ? "❚❚ Pause" : "▶ Lecture"}
          </button>
          <button className="btn-ghost" onClick={() => seek(tMs - 5000)} aria-label="Reculer de 5 secondes">↺ 5 s</button>
          <button className="btn-ghost" onClick={() => goMoment(-1)} aria-label="Événement précédent">⏮</button>
          <button className="btn-ghost" onClick={() => goMoment(1)} aria-label="Événement suivant">⏭</button>
          <span className="font-mono tabular-nums" data-testid="time-display">
            {formatMs(tMs)} / {formatMs(durationMs)}
            {gt != null && <span className="ml-2 text-muted">jeu {formatMs(gt)}</span>}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-muted">
              Vitesse
              <select className="input w-20 py-1" value={userRate} onChange={(e) => setUserRate(Number(e.target.value))} aria-label="Vitesse de lecture">
                {SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}
              </select>
            </label>
            <button className={`btn-ghost ${coachingOn ? "border-accent/60" : ""}`} aria-pressed={coachingOn} onClick={() => setCoachingOn((s) => !s)}>
              Coaching {coachingOn ? "activé" : "désactivé"}
            </button>
            <button className={`btn-ghost ${showAnn ? "border-accent/60" : ""}`} aria-pressed={showAnn} onClick={() => setShowAnn((s) => !s)} data-testid="toggle-annotations">
              Annotations {showAnn ? "visibles" : "masquées"}
            </button>
            <button className="btn-ghost" onClick={toggleFullscreen} aria-label="Plein écran">⛶</button>
          </div>
        </div>
        <p className="text-[11px] text-muted">
          Raccourcis : Espace/K lecture · J/L ±5 s · ,/. image par image · [ ] événement · A annotations · C coaching · F plein écran
        </p>
      </div>

      {/* ─── Panneau latéral ─── */}
      <aside className={`card min-w-0 space-y-4 ${fullscreen ? "overflow-auto" : ""}`}>
        <div className="flex flex-wrap gap-1 text-xs" role="tablist">
          <TabBtn active={panel.k === "moments" || panel.k === "moment"} onClick={() => setPanel({ k: "moments" })}>Moments ({moments.length})</TabBtn>
          {isOwner && <TabBtn active={panel.k === "annotate"} onClick={() => { videoRef.current?.pause(); setPanel({ k: "annotate" }); }}>Annoter</TabBtn>}
          {isOwner && <TabBtn active={panel.k === "form"} onClick={() => { videoRef.current?.pause(); setPanel({ k: "form" }); }}>+ Moment</TabBtn>}
          {isOwner && <TabBtn active={panel.k === "sync"} onClick={() => setPanel({ k: "sync" })}>Synchro</TabBtn>}
        </div>

        {panel.k === "moments" && (
          moments.length === 0 ? (
            <div className="text-sm text-muted">
              <p>Aucun moment de coaching sur cette vidéo.</p>
              {isOwner && (
                <p className="mt-2">
                  Mettez la vidéo en pause au moment d&apos;une décision intéressante (erreur, bonne action, objectif…) puis cliquez
                  « + Moment ». Ajoutez ensuite des annotations liées : trajectoire réelle, alternative, zone dangereuse…
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {moments.map((m) => (
                <li key={m.id}>
                  <button
                    className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-left text-sm hover:border-accent/60"
                    onClick={() => { seenRef.current.delete(m.id); seek(m.contextStartMs); setPanel({ k: "moment", id: m.id }); }}
                  >
                    <span className="font-mono text-xs text-muted">{formatMs(m.decisionMs)}</span>{" "}
                    <span aria-hidden>{KIND_ICON[m.kind]}</span> {m.title}
                    <span className="block text-xs text-muted">
                      {KIND_LABELS[m.kind]}
                      {m.provenance === "AUTOMATIC" && (m.status === "DRAFT" ? <span className="ml-1 text-warn">· proposition auto à valider</span> : <span className="ml-1 text-accent-2">· auto validée</span>)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        {panel.k === "moment" && activeMoment && (
          <div className="space-y-3">
            <button className="text-xs text-muted underline" onClick={() => setPanel({ k: "moments" })}>← Tous les moments</button>
            <MomentCard
              m={activeMoment}
              recordingId={recording.id}
              gameOffsetMs={recording.gameStartOffsetMs}
              onReplay={() => replay(activeMoment)}
              onContinue={pausedAt?.momentId === activeMoment.id ? continuePlayback : undefined}
              onSeek={seek}
              canReport
              isOwner={isOwner}
              onReviewed={(r) => {
                if (r) setMoments((s) => s.map((x) => (x.id === r.id ? r : x)));
                else {
                  setMoments((s) => s.filter((x) => x.id !== activeMoment.id));
                  setAnnotations((s) => s.filter((a) => a.recommendationId !== activeMoment.id));
                  setPanel({ k: "moments" });
                }
              }}
            />
            {isOwner && (
              <div className="flex gap-3 border-t border-line pt-3 text-xs">
                <button className="underline" onClick={() => setPanel({ k: "form", edit: activeMoment })}>Modifier</button>
                <button className="text-loss underline" onClick={() => deleteMoment(activeMoment.id)}>Supprimer</button>
              </div>
            )}
          </div>
        )}

        {panel.k === "annotate" && isOwner && (
          <AnnotationEditor
            draft={draft}
            setDraft={setDraft}
            hasMinimap={!!minimap}
            moments={moments}
            annotations={annotations}
            canSave={canSaveDraft}
            busy={editBusy}
            error={editError}
            onSave={saveDraft}
            onDelete={deleteAnnotation}
            onSetBound={setAnnotationBound}
            onSeek={seek}
            tMs={tMs}
          />
        )}

        {panel.k === "form" && isOwner && (
          <MomentForm
            key={panel.edit?.id ?? "new"}
            recordingId={recording.id}
            currentMs={() => (videoRef.current?.currentTime ?? 0) * 1000}
            durationMs={durationMs}
            initial={panel.edit}
            onCancel={() => setPanel({ k: "moments" })}
            onSaved={(r) => {
              setMoments((s) => [...s.filter((x) => x.id !== r.id), r].sort((a, b) => a.decisionMs - b.decisionMs));
              setPanel({ k: "moment", id: r.id });
            }}
          />
        )}

        {panel.k === "sync" && isOwner && (
          <SyncPanel recording={recording} tMs={tMs} onSaved={(r) => setRecording((s) => ({ ...s, ...r }))} />
        )}
      </aside>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 ${active ? "bg-accent/20 text-text" : "text-muted hover:bg-panel-2"}`}>
      {children}
    </button>
  );
}

function SyncPanel({ recording, tMs, onSaved }: { recording: RecordingDTO; tMs: number; onSaved: (r: Partial<RecordingDTO>) => void }) {
  const [clock, setClock] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function save(offset: number | null) {
    try {
      const r = await api<{ recording: RecordingDTO }>(`/api/recordings/${recording.id}`, { method: "PATCH", json: { gameStartOffsetMs: offset } });
      onSaved({ gameStartOffsetMs: r.recording.gameStartOffsetMs });
      setMsg(offset == null ? "Synchronisation retirée." : "Synchronisation enregistrée.");
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <h3 className="h2">Synchroniser avec l&apos;horloge du jeu</h3>
      <p className="text-xs text-muted">
        Mettez la vidéo en pause sur une image où l&apos;horloge de la partie est lisible, puis saisissez la valeur affichée.
        Cela permet d&apos;aligner la vidéo avec les statistiques du match (horodatages de jeu).
      </p>
      <p>Temps vidéo actuel : <span className="font-mono">{formatMs(tMs)}</span></p>
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        const c = parseClock(clock);
        if (c == null) return setMsg("Format attendu : mm:ss");
        void save(Math.round(tMs - c));
      }}>
        <input className="input w-28" placeholder="12:34" value={clock} onChange={(e) => setClock(e.target.value)} aria-label="Horloge en jeu" />
        <button className="btn-primary">Enregistrer</button>
      </form>
      {recording.gameStartOffsetMs != null && (
        <p className="text-xs text-muted">
          00:00 en jeu = {formatMs(recording.gameStartOffsetMs)} dans la vidéo.{" "}
          <button className="underline" onClick={() => save(null)}>Retirer</button>
        </p>
      )}
      {msg && <p role="status" className="text-xs">{msg}</p>}
      <p className="text-xs text-muted">
        Zone minimap : {recording.minimapRegion ? "définie" : "non définie"} (onglet « Annoter » → outil « Définir la zone minimap »).
      </p>
    </div>
  );
}
