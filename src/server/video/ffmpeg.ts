// Appels FFmpeg/ffprobe isolés : processus séparés, délai maximal, threads limités,
// annulation possible (AbortSignal). Aucun shell n'est utilisé (pas d'injection).
import { spawn } from "node:child_process";
import { env } from "@/lib/env";

export type ProbeResult = {
  durationMs: number;
  width: number;
  height: number;
  fps: number | null;
  videoCodec: string;
  audioCodec: string | null;
  formatName: string;
};

export class MediaError extends Error {}

function run(cmd: string, args: string[], opts: { timeoutMs: number; signal?: AbortSignal; onStderr?: (s: string) => void }) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new MediaError(`${cmd} : délai dépassé`));
    }, opts.timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr = (stderr + s).slice(-20000);
      opts.onStderr?.(s);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new MediaError("Traitement annulé"));
      if (code === 0) resolve({ stdout, stderr });
      else reject(new MediaError(`${cmd} a échoué (code ${code}) : ${stderr.split("\n").filter(Boolean).slice(-3).join(" | ")}`));
    });
  });
}

function parseRate(r: string | undefined): number | null {
  if (!r) return null;
  const [a, b] = r.split("/").map(Number);
  if (!a || !b) return null;
  return Math.round((a / b) * 100) / 100;
}

export async function probe(file: string): Promise<ProbeResult> {
  let out: string;
  try {
    ({ stdout: out } = await run(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { timeoutMs: 60_000 },
    ));
  } catch (e) {
    throw new MediaError("Fichier illisible ou corrompu (ffprobe n'a pas pu l'analyser).");
  }
  const data = JSON.parse(out) as {
    streams?: { codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }[];
    format?: { duration?: string; format_name?: string };
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  if (!video || !video.width || !video.height) throw new MediaError("Aucune piste vidéo exploitable dans ce fichier.");
  const duration = Number(data.format?.duration ?? video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new MediaError("Durée de la vidéo illisible (fichier tronqué ?).");
  return {
    durationMs: Math.round(duration * 1000),
    width: video.width,
    height: video.height,
    fps: parseRate(video.avg_frame_rate),
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    formatName: data.format?.format_name ?? "",
  };
}

/**
 * Produit un MP4 lisible par tous les navigateurs :
 *  • H.264 déjà présent dans un conteneur MP4/MOV → remux sans réencodage (+faststart)
 *  • sinon → transcodage H.264/AAC (preset veryfast), plafonné à 1080p.
 */
export async function makePlayback(input: string, output: string, p: ProbeResult, opts: { signal?: AbortSignal; onProgress?: (pct: number) => void }) {
  const isMp4Family = /mp4|mov/.test(p.formatName);
  const copyOk = isMp4Family && p.videoCodec === "h264" && (p.audioCodec === null || p.audioCodec === "aac");
  const common = ["-hide_banner", "-y", "-nostdin", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn"];
  const args = copyOk
    ? [...common, "-c", "copy", "-movflags", "+faststart", output]
    : [
        ...common,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-vf", "scale='min(1920,iw)':-2",
        "-c:a", "aac", "-b:a", "128k",
        "-threads", String(env.ffmpegThreads),
        "-movflags", "+faststart",
        output,
      ];
  await run("ffmpeg", args, {
    timeoutMs: env.ffmpegTimeoutSec * 1000,
    signal: opts.signal,
    onStderr: (s) => {
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && opts.onProgress) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        opts.onProgress(Math.min(99, (sec * 1000 * 100) / p.durationMs));
      }
    },
  });
  return { remuxed: copyOk };
}

export async function makeThumbnail(input: string, output: string, durationMs: number) {
  const at = Math.max(0, Math.min(durationMs / 1000 - 0.1, (durationMs / 1000) * 0.1));
  await run(
    "ffmpeg",
    ["-hide_banner", "-y", "-nostdin", "-ss", at.toFixed(2), "-i", input, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", output],
    { timeoutMs: 60_000 },
  );
}
