// Tâche EXPORT_CLIP : rendu d'un clip avec ses corrections incrustées (Python/Pillow + FFmpeg).
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnalysisJob } from "@prisma/client";
import { prisma } from "./db";
import { storage, recordingPrefix } from "./storage";
import { JobCancelledError, PermanentJobError, setJobProgress } from "./jobs";
import { recordingAccess } from "./permissions";
import { visibleAnnotationWhere, visibleRecommendationWhere } from "./analysis/review";
import { analyzerAvailable } from "./analysis/runner";
import { notify } from "./notifications";
import { env } from "@/lib/env";
import { CONFIDENCE_LABELS } from "@/lib/annotations/schema";

const RENDERER = path.resolve(process.cwd(), "analysis/render_clip.py");

export async function exportClip(job: AnalysisJob) {
  const clipId = (job.payload as { clipId?: string } | null)?.clipId;
  if (!clipId) throw new PermanentJobError("Tâche sans clip.");
  const clip = await prisma.clip.findUnique({ where: { id: clipId } });
  if (!clip) throw new JobCancelledError("Clip supprimé.");
  const access = await recordingAccess(clip.ownerId, clip.recordingId);
  if (!access) throw new PermanentJobError("La vidéo n'est plus accessible (partage retiré).");
  const rec = await prisma.recording.findUniqueOrThrow({ where: { id: clip.recordingId } });
  if (rec.status !== "READY" || !rec.playbackKey || !rec.width || !rec.height) throw new PermanentJobError("Vidéo non prête.");
  const av = await analyzerAvailable();
  if (!av.ok) throw new PermanentJobError(`Export non configuré : ${av.reason}`);

  await prisma.clip.update({ where: { id: clip.id }, data: { exportStatus: "RUNNING", exportError: null } });
  const isOwner = access === "owner";
  const [annotations, moments] = await Promise.all([
    prisma.videoAnnotation.findMany({
      where: { recordingId: rec.id, startMs: { lt: clip.endMs }, endMs: { gt: clip.startMs }, ...visibleAnnotationWhere(isOwner) },
      orderBy: { startMs: "asc" },
    }),
    prisma.recommendation.findMany({
      where: { recordingId: rec.id, decisionMs: { gte: clip.startMs, lt: clip.endMs }, ...visibleRecommendationWhere(isOwner), status: { not: "DRAFT" } },
      include: { observations: { orderBy: { createdAt: "asc" }, take: 2 } },
      orderBy: { decisionMs: "asc" },
    }),
  ]);
  // Les propositions automatiques non validées ne sont jamais incrustées.
  const momentIds = new Set(moments.map((m) => m.id));
  const anns = annotations.filter((a) => !a.recommendationId || momentIds.has(a.recommendationId));
  const automatic = anns.some((a) => a.provenance === "AUTOMATIC") || moments.some((m) => m.provenance === "AUTOMATIC");

  const tmp = await mkdtemp(path.join(os.tmpdir(), "coachgg-export-"));
  try {
    const out = path.join(tmp, "export.mp4");
    const spec = {
      video: storage().localPath(rec.playbackKey),
      out,
      startMs: clip.startMs,
      endMs: clip.endMs,
      width: rec.width,
      height: rec.height,
      minimap: rec.minimapRegion,
      footer: `CoachGG · ${clip.title} · ${automatic ? "contient des propositions automatiques validées" : "annoté manuellement"}`,
      annotations: anns.map((a) => ({ type: a.type, style: a.style, space: a.space, geometry: a.geometry, startMs: a.startMs, endMs: a.endMs, label: a.label, recommendationId: a.recommendationId })),
      moments: moments.map((m) => {
        const alt = (m.alternatives as { label: string; conditions?: string }[])[0];
        return {
          id: m.id,
          title: m.title,
          contextStartMs: m.contextStartMs,
          slowdownStartMs: m.slowdownStartMs,
          decisionMs: m.decisionMs,
          endMs: m.endMs,
          slowdownRate: m.slowdownRate,
          observation: m.observations.map((o) => o.text).join(" "),
          alternative: alt ? `${alt.label}${alt.conditions ? ` (si ${alt.conditions})` : ""}` : "",
          advice: m.advice,
          confidence: CONFIDENCE_LABELS[m.confidence],
        };
      }),
    };
    const specPath = path.join(tmp, "spec.json");
    await writeFile(specPath, JSON.stringify(spec));
    await runRenderer(specPath, job.id);

    const still = await prisma.clip.findUnique({ where: { id: clip.id }, select: { id: true } });
    if (!still) throw new JobCancelledError("Clip supprimé pendant le rendu.");
    const key = `${recordingPrefix(rec.ownerId, rec.id)}exports/${clip.id}.mp4`;
    await storage().importFile(key, out);
    await prisma.clip.update({ where: { id: clip.id }, data: { exportStatus: "READY", exportKey: key, exportedAt: new Date() } });
    await notify(clip.ownerId, { type: "clip_exported", title: "Vidéo annotée prête", body: `« ${clip.title} » peut être téléchargé.`, link: "/app/clips" });
    return { key, annotations: anns.length, moments: moments.length };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export function runRenderer(specPath: string, jobId: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(env.pythonBin, [RENDERER, specPath], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    let last = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Rendu : délai maximal dépassé."));
    }, env.analysisTimeoutSec * 1000);
    child.stderr.on("data", (d) => {
      const s = d.toString();
      err = (err + s).slice(-4000);
      for (const m of s.matchAll(/PROGRESS (\d+)/g)) {
        const p = Number(m[1]);
        if (p - last >= 10) {
          last = p;
          setJobProgress(jobId, p * 0.95).catch(() => child.kill("SIGKILL"));
        }
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new PermanentJobError(`Python introuvable : ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Rendu échoué : ${err.match(/ERROR (.+)/)?.[1] ?? `code ${code}`}`));
    });
  });
}

export async function markExportFailed(clipId: string, message: string) {
  await prisma.clip.updateMany({ where: { id: clipId }, data: { exportStatus: "FAILED", exportError: message.slice(0, 500) } });
}
