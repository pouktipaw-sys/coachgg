// Exécution de l'analyseur Python dans un processus séparé (pas de shell,
// délai maximal, threads limités, annulable). Sa sortie est validée par zod.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { analysisOutputSchema, type AnalysisOutput } from "@/lib/analysis/rules";

export class AnalyzerUnavailableError extends Error {}
export class AnalyzerError extends Error {}

export const ANALYZER_SCRIPT = path.resolve(process.cwd(), "analysis/analyze.py");

/** Vérifie que Python + OpenCV sont utilisables (résultat mis en cache). */
let availability: Promise<{ ok: boolean; reason?: string }> | null = null;
export function analyzerAvailable(): Promise<{ ok: boolean; reason?: string }> {
  availability ??= new Promise((resolve) => {
    if (!existsSync(ANALYZER_SCRIPT)) return resolve({ ok: false, reason: "Script d'analyse introuvable." });
    const p = spawn(env.pythonBin, ["-c", "import cv2, numpy"], { stdio: "ignore" });
    const t = setTimeout(() => p.kill("SIGKILL"), 20_000);
    p.on("error", () => {
      clearTimeout(t);
      resolve({ ok: false, reason: `Python introuvable (${env.pythonBin}).` });
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve(code === 0 ? { ok: true } : { ok: false, reason: "OpenCV/NumPy non installés pour l'analyse." });
    });
  });
  return availability;
}

/** Tests : force une nouvelle vérification de disponibilité. */
export function resetAnalyzerAvailability() {
  availability = null;
}

export type AnalyzeArgs = {
  video: string;
  outDir: string;
  width: number;
  height: number;
  durationMs: number;
  contextSec: number;
  minimap: { x: number; y: number; w: number; h: number } | null;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
};

export async function runAnalyzer(a: AnalyzeArgs): Promise<AnalysisOutput> {
  const av = await analyzerAvailable();
  if (!av.ok) throw new AnalyzerUnavailableError(`Analyse non configurée : ${av.reason}`);
  const args = [
    ANALYZER_SCRIPT,
    "--video", a.video,
    "--out", a.outDir,
    "--width", String(a.width),
    "--height", String(a.height),
    "--duration-ms", String(a.durationMs),
    "--context-sec", String(a.contextSec),
    "--threads", String(env.ffmpegThreads),
    ...(a.minimap ? ["--minimap", [a.minimap.x, a.minimap.y, a.minimap.w, a.minimap.h].join(",")] : []),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(env.pythonBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, OMP_NUM_THREADS: String(env.ffmpegThreads), OPENCV_FFMPEG_THREADS: String(env.ffmpegThreads) },
    });
    let out = "";
    let errTail = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new AnalyzerError("Analyse : délai maximal dépassé."));
    }, env.analysisTimeoutSec * 1000);
    const onAbort = () => child.kill("SIGKILL");
    a.signal?.addEventListener("abort", onAbort);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.length > 5_000_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      errTail = (errTail + s).slice(-4000);
      for (const m of s.matchAll(/PROGRESS (\d+)/g)) a.onProgress?.(Number(m[1]));
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new AnalyzerUnavailableError(`Python introuvable : ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      a.signal?.removeEventListener("abort", onAbort);
      if (a.signal?.aborted) return reject(new AnalyzerError("Analyse annulée."));
      if (code !== 0) {
        const msg = errTail.match(/ERROR (.+)/)?.[1] ?? `code ${code}`;
        return reject(new AnalyzerError(`L'analyseur a échoué : ${msg}`));
      }
      try {
        resolve(analysisOutputSchema.parse(JSON.parse(out)));
      } catch {
        reject(new AnalyzerError("Sortie de l'analyseur invalide."));
      }
    });
  });
}
