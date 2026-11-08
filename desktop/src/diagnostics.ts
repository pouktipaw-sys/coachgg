// Test d'enregistrement : capture quelques secondes et vérifie que l'image est exploitable.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveBackend, type AgentConfig } from "./config";
import { frameLuma, isBlankFrame, startRecording } from "./recorder";

export type TestResult = { ok: boolean; backend: string; sizeBytes?: number; luma?: { mean: number; std: number } | null; message: string };

export function ffmpegAvailable(ffmpeg = "ffmpeg") {
  const r = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout.split("\n")[0] ?? "ffmpeg") : null;
}

export async function testRecording(cfg: AgentConfig, seconds = 4): Promise<TestResult> {
  const backend = resolveBackend(cfg);
  if (!ffmpegAvailable()) return { ok: false, backend, message: "FFmpeg introuvable : installez-le ou placez ffmpeg.exe à côté de l'application." };
  if (backend === "none") return { ok: false, backend, message: "Aucune méthode de capture sur ce système : la capture du jeu nécessite Windows." };
  const dir = mkdtempSync(path.join(os.tmpdir(), "coachgg-test-"));
  const out = path.join(dir, "test.mp4");
  try {
    const h = startRecording(backend, cfg.capture, out, { durationSec: seconds });
    await h.done;
    let sizeBytes = 0;
    try {
      sizeBytes = statSync(out).size;
    } catch {
      return {
        ok: false,
        backend,
        message:
          backend === "gdigrab"
            ? `Fenêtre « ${cfg.capture.windowTitle} » introuvable. Lancez une partie (ou l'entraînement) puis relancez le test.`
            : "Aucune vidéo produite.",
      };
    }
    const luma = await frameLuma(out, Math.max(0.5, seconds / 2));
    if (isBlankFrame(luma))
      return {
        ok: false,
        backend,
        sizeBytes,
        luma,
        message: "La vidéo est noire ou uniforme : la capture de fenêtre ne voit pas le jeu. Passez le jeu en mode « Fenêtré sans bordure » et relancez le test.",
      };
    return { ok: true, backend, sizeBytes, luma, message: `Capture fonctionnelle (${(sizeBytes / 1024).toFixed(0)} Ko pour ${seconds} s).` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
