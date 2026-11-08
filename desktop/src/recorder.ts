// Enregistrement via FFmpeg (processus séparé, sans shell).
// • gdigrab (Windows) : capture de la seule fenêtre du jeu, par son titre.
// • testsrc : source de test (développement, tests automatisés).
// MP4 fragmenté : un fichier interrompu (plantage, coupure) reste lisible.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { AgentConfig } from "./config";

export type Backend = "gdigrab" | "testsrc";

export function buildRecordArgs(backend: Backend, cfg: AgentConfig["capture"], out: string, opts: { maxBytes?: number; durationSec?: number } = {}): string[] {
  const input =
    backend === "gdigrab"
      ? ["-f", "gdigrab", "-framerate", String(cfg.fps), "-draw_mouse", "1", "-i", `title=${cfg.windowTitle}`]
      : ["-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=${cfg.fps}`];
  const enc =
    cfg.encoder === "libx264"
      ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", String(cfg.quality), "-pix_fmt", "yuv420p"]
      : ["-c:v", cfg.encoder, "-cq", String(cfg.quality), "-pix_fmt", "yuv420p"];
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    ...input,
    // Pas d'audio : ni son du jeu, ni micro (désactivés dans cette version).
    "-an",
    "-vf", `scale=-2:'min(${cfg.maxHeight},ih)'`,
    ...enc,
    "-g", String(cfg.fps * 2),
    ...(opts.durationSec ? ["-t", String(opts.durationSec)] : []),
    ...(opts.maxBytes ? ["-fs", String(opts.maxBytes)] : []),
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    out,
  ];
}

export type RecordingHandle = { out: string; startedAt: Date; stop: () => Promise<{ sizeBytes: number; exitCode: number | null }>; done: Promise<number | null> };

export function startRecording(backend: Backend, cfg: AgentConfig["capture"], out: string, opts: { maxBytes?: number; durationSec?: number; ffmpeg?: string } = {}): RecordingHandle {
  const child: ChildProcess = spawn(opts.ffmpeg ?? "ffmpeg", buildRecordArgs(backend, cfg, out, opts), { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr = (stderr + d.toString()).slice(-4000)));
  const done = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(-1));
  });
  return {
    out,
    startedAt: new Date(),
    done,
    async stop() {
      // Arrêt propre : « q » sur l'entrée standard, puis arrêt forcé après 10 s.
      if (child.exitCode == null) {
        child.stdin?.write("q");
        child.stdin?.end();
        const t = setTimeout(() => child.kill("SIGKILL"), 10_000);
        await done;
        clearTimeout(t);
      }
      const code = await done;
      if (!existsSync(out)) throw new Error(`Aucun fichier produit par FFmpeg. ${stderr.split("\n").filter(Boolean).slice(-2).join(" | ")}`);
      return { sizeBytes: statSync(out).size, exitCode: code };
    },
  };
}

/** Statistiques de luminance d'une image extraite (détection d'image noire ou figée). */
export function frameLuma(file: string, atSec: number, ffmpeg = "ffmpeg"): Promise<{ mean: number; std: number } | null> {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ["-v", "error", "-ss", String(atSec), "-i", file, "-frames:v", "1", "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "-"]);
    const chunks: Buffer[] = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("error", () => resolve(null));
    p.on("close", () => {
      const b = Buffer.concat(chunks);
      if (b.length < 64 * 36) return resolve(null);
      let sum = 0;
      for (const v of b) sum += v;
      const mean = sum / b.length;
      let sq = 0;
      for (const v of b) sq += (v - mean) ** 2;
      resolve({ mean: Math.round(mean * 10) / 10, std: Math.round(Math.sqrt(sq / b.length) * 10) / 10 });
    });
  });
}

/** Une image est jugée inexploitable si elle est quasi uniforme (noire, blanche ou vide). */
export function isBlankFrame(l: { mean: number; std: number } | null) {
  return !l || l.std < 3;
}
