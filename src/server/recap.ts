// Tâche RENDER_RECAP : vidéo récap d'une partie analysée — carte d'intro, chaque moment
// (contexte, ralenti, pause à la décision, schéma, conseil), puis carte de bilan.
// Les propositions automatiques non validées y figurent, marquées « à vérifier ».
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnalysisJob } from "@prisma/client";
import { prisma } from "./db";
import { storage, recordingPrefix } from "./storage";
import { JobCancelledError, PermanentJobError, enqueueJob, retryJob } from "./jobs";
import { analyzerAvailable } from "./analysis/runner";
import { runRenderer } from "./clipExport";
import { notify } from "./notifications";
import { formatMs } from "@/lib/annotations/coaching";
import { CONFIDENCE_LABELS } from "@/lib/annotations/schema";
import type { GameReport } from "./analysis/ai";

const MAX_MOMENTS = 12;
const MAX_SEGMENT_MS = 45_000;

export async function requestRecap(recordingId: string) {
  await prisma.recording.update({ where: { id: recordingId }, data: { recapStatus: "PENDING", recapError: null } });
  const job = await enqueueJob({ type: "RENDER_RECAP", idempotencyKey: `recap:${recordingId}`, recordingId, maxAttempts: 2 });
  if (job.status === "PENDING" || job.status === "RUNNING") return job;
  return retryJob(job.id);
}

const origin = (m: { provenance: string; status: string; analysisVersion: string | null }) =>
  m.provenance !== "AUTOMATIC"
    ? null
    : m.status === "DRAFT"
      ? m.analysisVersion?.startsWith("ia")
        ? "Analyse IA (Claude) — proposition à vérifier"
        : "Détection automatique (règles) — à vérifier"
      : "Proposition automatique validée";

export async function renderRecap(job: AnalysisJob) {
  if (!job.recordingId) throw new PermanentJobError("Tâche sans vidéo.");
  const rec = await prisma.recording.findUnique({ where: { id: job.recordingId } });
  if (!rec) throw new JobCancelledError("Vidéo supprimée.");
  if (rec.status !== "READY" || !rec.playbackKey || !rec.width || !rec.height) throw new PermanentJobError("Vidéo non prête.");
  const av = await analyzerAvailable();
  if (!av.ok) throw new PermanentJobError(`Récap non configuré : ${av.reason}`);
  await prisma.recording.update({ where: { id: rec.id }, data: { recapStatus: "RUNNING", recapError: null } });

  const moments = await prisma.recommendation.findMany({
    where: { recordingId: rec.id, status: { not: "REJECTED" } },
    include: { observations: { orderBy: { createdAt: "asc" }, take: 2 }, annotations: true },
    orderBy: { decisionMs: "asc" },
    take: MAX_MOMENTS,
  });
  if (!moments.length) throw new PermanentJobError("Aucun moment à monter.");
  const report = rec.gameReport as GameReport | null;
  const footer = `CoachGG · récap · ${rec.title}`.slice(0, 90);
  const ai = moments.some((m) => m.analysisVersion?.startsWith("ia"));

  const items: object[] = [
    {
      mode: "card",
      seconds: 4,
      title: `Récap de la partie — ${rec.title}`,
      subtitle: `${moments.length} moment(s) à revoir · ${ai ? "analysés par l'IA (Claude)" : "détection automatique et tes annotations"}`,
      sections: [{ label: "Au programme", lines: moments.slice(0, 6).map((m) => `${formatMs(m.decisionMs)} — ${m.title}`) }],
      footer,
    },
    ...moments.map((m) => {
      const startMs = m.contextStartMs;
      const endMs = Math.min(m.endMs, startMs + MAX_SEGMENT_MS, rec.durationMs ?? m.endMs);
      const alt = (m.alternatives as { label: string; conditions?: string }[])[0];
      return {
        video: storage().localPath(rec.playbackKey!),
        startMs,
        endMs,
        minimap: rec.minimapRegion,
        footer,
        annotations: m.annotations
          .filter((a) => a.startMs < endMs && a.endMs > startMs)
          .map((a) => ({ type: a.type, style: a.style, space: a.space, geometry: a.geometry, startMs: a.startMs, endMs: a.endMs, label: a.label, recommendationId: a.recommendationId })),
        moments: [
          {
            id: m.id,
            title: m.title,
            contextStartMs: m.contextStartMs,
            slowdownStartMs: m.slowdownStartMs,
            decisionMs: m.decisionMs,
            endMs,
            slowdownRate: m.slowdownRate,
            observation: m.observations.map((o) => o.text).join(" "),
            alternative: alt ? `${alt.label}${alt.conditions ? ` (si ${alt.conditions})` : ""}` : "",
            advice: m.advice,
            confidence: CONFIDENCE_LABELS[m.confidence],
            origin: origin(m),
          },
        ],
      };
    }),
  ];
  if (report)
    items.push({
      mode: "card",
      seconds: 8,
      title: "Bilan de la partie",
      subtitle: report.source === "ai" ? "Rédigé par l'IA (Claude) à partir des moments analysés" : "Établi à partir des moments détectés",
      sections: [
        { label: "En bref", lines: [report.summary] },
        { label: "3 priorités", color: [251, 191, 36], lines: report.priorities.map((p) => `${p.title} : ${p.drill}`) },
        { label: "Objectif pour la prochaine partie", color: [49, 196, 141], lines: [report.nextGameGoal] },
      ],
      footer,
    });

  const tmp = await mkdtemp(path.join(os.tmpdir(), "coachgg-recap-"));
  try {
    const out = path.join(tmp, "recap.mp4");
    const specPath = path.join(tmp, "spec.json");
    await writeFile(specPath, JSON.stringify({ mode: "recap", out, width: rec.width, height: rec.height, items }));
    await runRenderer(specPath, job.id);
    const still = await prisma.recording.findUnique({ where: { id: rec.id }, select: { id: true } });
    if (!still) throw new JobCancelledError("Vidéo supprimée pendant le montage.");
    const key = `${recordingPrefix(rec.ownerId, rec.id)}exports/recap.mp4`;
    await storage().importFile(key, out);
    await prisma.recording.update({ where: { id: rec.id }, data: { recapKey: key, recapStatus: "READY", recapAt: new Date(), recapError: null } });
    await notify(rec.ownerId, { type: "recap_ready", title: "Ta vidéo récap est prête 🎬", body: `« ${rec.title} » : ${moments.length} moment(s) annotés et le bilan.`, link: `/app/videos/${rec.id}#recap` });
    return { key, moments: moments.length, report: !!report };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function markRecapFailed(recordingId: string, message: string) {
  await prisma.recording.updateMany({ where: { id: recordingId }, data: { recapStatus: "FAILED", recapError: message.slice(0, 500) } });
}
