"use client";
// Lecture synchronisée de plusieurs vidéos d'un même match sur une horloge de jeu commune.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMs } from "@/lib/annotations/coaching";
import { gameRange, needsResync, videoPositionFor } from "@/lib/video/sync";

export type SyncTrackDTO = {
  id: string;
  title: string;
  ownerName: string;
  mine: boolean;
  gameStartOffsetMs: number;
  durationMs: number;
  moments: { id: string; title: string; gameMs: number }[];
};

const RATES = [0.25, 0.5, 1, 1.5, 2];

function fmtGame(ms: number) {
  return ms < 0 ? `−${formatMs(-ms)}` : formatMs(ms);
}

export function SyncViewer({ tracks }: { tracks: SyncTrackDTO[] }) {
  const range = gameRange(tracks)!;
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const clock = useRef({ baseGame: Math.max(0, range.startMs), baseNow: 0 });
  const lastSeek = useRef<Record<string, number>>({});
  const [gameMs, setGameMs] = useState(Math.max(0, range.startMs));
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [audio, setAudio] = useState(tracks.find((t) => t.mine)?.id ?? tracks[0]!.id);
  const [outOfRange, setOutOfRange] = useState<Record<string, boolean>>({});

  const now = useCallback(() => {
    if (!playing) return clock.current.baseGame;
    return clock.current.baseGame + (performance.now() - clock.current.baseNow) * rate;
  }, [playing, rate]);

  /** Aligne chaque vidéo sur le temps de jeu `g`. */
  const apply = useCallback(
    (g: number, force: boolean) => {
      const oor: Record<string, boolean> = {};
      for (const t of tracks) {
        const v = videos.current[t.id];
        if (!v) continue;
        const pos = videoPositionFor(g, t);
        oor[t.id] = !pos.inRange;
        if (Math.abs(v.playbackRate - rate) > 0.001) v.playbackRate = rate;
        const since = performance.now() - (lastSeek.current[t.id] ?? 0);
        if (force || (needsResync(v.currentTime * 1000, pos.videoMs, 300) && since > 1000)) {
          v.currentTime = pos.videoMs / 1000;
          lastSeek.current[t.id] = performance.now();
        }
        if (playing && pos.inRange) {
          if (v.paused) void v.play().catch(() => {});
        } else if (!v.paused) v.pause();
      }
      setOutOfRange((prev) => (tracks.some((t) => prev[t.id] !== oor[t.id]) ? oor : prev));
    },
    [tracks, playing, rate],
  );

  useEffect(() => {
    if (!playing) {
      apply(clock.current.baseGame, false);
      return;
    }
    let raf = 0;
    const tick = () => {
      let g = now();
      if (g >= range.endMs) {
        g = range.endMs;
        clock.current = { baseGame: g, baseNow: performance.now() };
        setPlaying(false);
      }
      setGameMs(g);
      apply(g, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, now, apply, range.endMs]);

  const seek = (g: number) => {
    const clamped = Math.min(range.endMs, Math.max(range.startMs, g));
    clock.current = { baseGame: clamped, baseNow: performance.now() };
    setGameMs(clamped);
    apply(clamped, true);
  };
  const toggle = () => {
    clock.current = { baseGame: now(), baseNow: performance.now() };
    setPlaying((p) => !p);
  };
  const changeRate = (r: number) => {
    clock.current = { baseGame: now(), baseNow: performance.now() };
    setRate(r);
  };

  const moments = tracks
    .flatMap((t) => t.moments.map((m) => ({ ...m, trackTitle: t.title })))
    .sort((a, b) => a.gameMs - b.gameMs);

  return (
    <div className="space-y-4">
      <div className={`grid gap-3 ${tracks.length > 1 ? "md:grid-cols-2" : ""}`}>
        {tracks.map((t) => (
          <figure key={t.id} className="card space-y-2 p-2" data-testid="sync-track">
            <div className="relative overflow-hidden rounded bg-black">
              <video
                ref={(el) => {
                  videos.current[t.id] = el;
                }}
                src={`/api/recordings/${t.id}/stream`}
                preload="metadata"
                playsInline
                muted={audio !== t.id}
                className="aspect-video w-full"
                onLoadedMetadata={() => apply(clock.current.baseGame, true)}
              />
              {outOfRange[t.id] && (
                <div className="absolute inset-0 grid place-items-center bg-black/70 text-sm text-muted">Cette vidéo ne couvre pas cet instant de la partie</div>
              )}
            </div>
            <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <Link className="underline" href={`/app/videos/${t.id}?t=${Math.max(0, Math.round((gameMs + t.gameStartOffsetMs) / 1000))}`}>
                {t.title}
              </Link>
              <span className="text-muted">{t.mine ? "Ma vidéo" : `Partagée par ${t.ownerName}`}</span>
              <label className="flex items-center gap-1">
                <input type="radio" name="audio" checked={audio === t.id} onChange={() => setAudio(t.id)} /> Son
              </label>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="card flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={toggle} data-testid="sync-play">
          {playing ? "⏸ Pause" : "▶ Lecture"}
        </button>
        <button className="btn" onClick={() => seek(now() - 5000)}>−5 s</button>
        <button className="btn" onClick={() => seek(now() + 5000)}>+5 s</button>
        <span className="font-mono text-sm" data-testid="sync-clock">Temps de jeu {fmtGame(gameMs)}</span>
        <input
          type="range"
          aria-label="Temps de jeu"
          className="min-w-48 flex-1"
          min={range.startMs}
          max={range.endMs}
          step={100}
          value={gameMs}
          onChange={(e) => seek(Number(e.target.value))}
          data-testid="sync-seek"
        />
        <select className="input w-auto" value={rate} onChange={(e) => changeRate(Number(e.target.value))} aria-label="Vitesse">
          {RATES.map((r) => (
            <option key={r} value={r}>
              ×{r}
            </option>
          ))}
        </select>
      </div>

      {moments.length > 0 && (
        <section className="card">
          <h2 className="h2">Moments publiés</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {moments.map((m) => (
              <li key={m.id}>
                <button className="underline" onClick={() => seek(m.gameMs - 5000)}>
                  {fmtGame(m.gameMs)}
                </button>{" "}
                — {m.title} <span className="text-xs text-muted">({m.trackTitle})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
