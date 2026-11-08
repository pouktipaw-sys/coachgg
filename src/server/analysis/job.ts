// Tâche ANALYZE_RECORDING — pipeline traçable :
// validation → association au match → synchronisation → extraction des signaux
// (sélection des séquences + contexte) → propositions (règles versionnées)
// → annotations → enregistrement en brouillon pour revue humaine.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnalysisJob, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { storage, recordingPrefix } from "../storage";
import { enqueueJob, JobCancelledError, PermanentJobError, retryJob, setJobProgress } from "../jobs";
import { notify } from "../notifications";
import { AnalyzerError, AnalyzerUnavailableError, analyzerAvailable, runAnalyzer } from "./runner";
import { buildProposals, RULES_VERSION } from "@/lib/analysis/rules";
import { ANNOTATION_SCHEMA_VERSION } from "@/lib/annotations/schema";

type Step = { name: string; status: "ok" | "skipped" | "warning" | "failed"; ms: number; note?: string };

export const CONTEXT_CHOICES = [6, 10, 15] as const;

/** Met en file (ou relance) l'analyse d'une vidéo prête. Idempotent : une tâche par vidéo. */
export async function requestAnalysis(recordingId: string, contextSec = 10) {
  const key = `analyze:${recordingId}`;
  const job = await enqueueJob({ type: "ANALYZE_RECORDING", idempotencyKey: key, recordingId, payload: { contextSec }, maxAttempts: 2 });
  if (job.status === "RUNNING") return job;
  if (job.status !== "PENDING" || JSON.stringify(job.payload) !== JSON.stringify({ contextSec })) {
    await prisma.analysisJob.update({ where: { id: job.id }, data: { payload: { contextSec }, version: RULES_VERSION } });
    return retryJob(job.id);
  }
  return job;
}

/** Après traitement vidéo : lance l'analyse automatiquement si le worker en est capable. */
export async function autoRequestAnalysis(recordingId: string) {
  if ((await analyzerAvailable()).ok) await requestAnalysis(recordingId);
}

export async function analyzeRecording(job: AnalysisJob) {
  const steps: Step[] = [];
  const step = async <T,>(name: string, fn: () => Promise<{ value: T; status?: Step["status"]; note?: string }>) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      steps.push({ name, status: r.status ?? "ok", ms: Date.now() - t0, note: r.note });
      return r.value;
    } catch (e) {
      steps.push({ name, status: "failed", ms: Date.now() - t0, note: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };
  const contextSec = Number((job.payload as { contextSec?: number } | null)?.contextSec ?? 10);

  // 1. Validation
  const rec = await step("Validation de la vidéo", async () => {
    if (!job.recordingId) throw new PermanentJobError("Tâche sans vidéo.");
    const r = await prisma.recording.findUnique({ where: { id: job.recordingId } });
    if (!r) throw new JobCancelledError("Vidéo supprimée.");
    if (r.status !== "READY" || !r.playbackKey || !r.durationMs || !r.width || !r.height)
      throw new PermanentJobError("La vidéo doit être prête (traitée) avant l'analyse.");
    return { value: r };
  });

  // 2. Association au match
  await step("Association au match", async () =>
    rec.matchId ? { value: null, note: "Vidéo liée à un match." } : { value: null, status: "skipped", note: "Aucun match lié : statistiques non croisées." },
  );

  // 3. Synchronisation des horodatages
  await step("Synchronisation des horodatages", async () =>
    rec.gameStartOffsetMs != null
      ? { value: null, note: "Temps de jeu affiché dans les observations." }
      : { value: null, status: "skipped", note: "Pas de synchronisation avec l'horloge du jeu : temps vidéo uniquement." },
  );

  const minimap = (rec.minimapRegion as { x: number; y: number; w: number; h: number } | null) ?? null;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "coachgg-an-"));
  const abort = new AbortController();
  try {
    // 4-5. Sélection des séquences + extraction d'images et de signaux (contexte avant l'action)
    let last = 0;
    let cancelled = false;
    const out = await step("Extraction des signaux et sélection des séquences", async () => {
      try {
        const o = await runAnalyzer({
          video: storage().localPath(rec.playbackKey!),
          outDir: tmp,
          width: rec.width!,
          height: rec.height!,
          durationMs: rec.durationMs!,
          contextSec,
          minimap,
          signal: abort.signal,
          onProgress: (p) => {
            if (p - last < 5) return;
            last = p;
            setJobProgress(job.id, p * 0.9).catch(() => {
              cancelled = true;
              abort.abort();
            });
          },
        });
        return {
          value: o,
          status: o.warnings.length ? "warning" : "ok",
          note: `${o.sampling.frames} images échantillonnées à ${o.sampling.fps} i/s ; ${o.events.length} séquence(s) retenue(s).${o.warnings.length ? " " + o.warnings.join(" ") : ""}`,
        };
      } catch (e) {
        if (cancelled) throw new JobCancelledError("Analyse annulée.");
        if (e instanceof AnalyzerUnavailableError) throw new PermanentJobError(e.message);
        if (e instanceof AnalyzerError) throw e; // nouvelle tentative possible
        throw e;
      }
    });

    // 6-8. Analyse du contexte, propositions de diagnostic, alternatives (règles versionnées)
    const proposals = await step("Propositions (règles " + RULES_VERSION + ")", async () => {
      const p = buildProposals(out, { durationMs: rec.durationMs!, gameStartOffsetMs: rec.gameStartOffsetMs });
      return { value: p, note: `${p.length} proposition(s).` };
    });

    // 9-10. Annotations + rapport : remplace les brouillons automatiques précédents (idempotent)
    const created = await step("Annotations et enregistrement pour revue", async () => {
      const still = await prisma.recording.findUnique({ where: { id: rec.id }, select: { id: true } });
      if (!still) throw new JobCancelledError("Vidéo supprimée pendant l'analyse.");
      const old = await prisma.recommendation.findMany({ where: { recordingId: rec.id, provenance: "AUTOMATIC", status: "DRAFT" }, select: { id: true, contextSheetKey: true } });
      for (const o of old) if (o.contextSheetKey) await storage().delete(o.contextSheetKey);
      await prisma.videoAnnotation.deleteMany({ where: { recordingId: rec.id, provenance: "AUTOMATIC", recommendation: { status: "DRAFT" } } });
      await prisma.recommendation.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

      // Une proposition déjà validée ou rejetée au même instant n'est pas recréée.
      const reviewed = await prisma.recommendation.findMany({
        where: { recordingId: rec.id, provenance: "AUTOMATIC", status: { not: "DRAFT" } },
        select: { decisionMs: true, kind: true },
      });
      let n = 0;
      for (const p of proposals) {
        if (reviewed.some((r) => r.kind === p.recommendation.kind && Math.abs(r.decisionMs - p.recommendation.decisionMs) < 3000)) continue;
        const r = p.recommendation;
        let sheetKey: string | null = null;
        if (p.sheet) {
          sheetKey = `${recordingPrefix(rec.ownerId, rec.id)}analysis/${job.id}-${n}.jpg`;
          await storage().importFile(sheetKey, path.join(tmp, p.sheet));
        }
        await prisma.recommendation.create({
          data: {
            recordingId: rec.id,
            kind: r.kind,
            category: r.category,
            title: r.title,
            contextStartMs: r.contextStartMs,
            slowdownStartMs: r.slowdownStartMs,
            decisionMs: r.decisionMs,
            endMs: r.endMs,
            slowdownRate: r.slowdownRate,
            interpretation: r.interpretation,
            alternatives: r.alternatives,
            confidence: r.confidence,
            confidenceReason: r.confidenceReason,
            advice: r.advice,
            provenance: "AUTOMATIC",
            analysisVersion: RULES_VERSION,
            status: "DRAFT",
            analysisJobId: job.id,
            autoEvidence: p.evidence as Prisma.InputJsonValue,
            contextSheetKey: sheetKey,
            observations: {
              create: r.observations.map((text) => ({
                text,
                recordingId: rec.id,
                timeMs: r.decisionMs,
                category: r.category,
                source: "video",
                provenance: "AUTOMATIC",
                analysisJobId: job.id,
                analysisVersion: RULES_VERSION,
              })),
            },
            annotations: {
              create: p.annotations.map((a) => ({
                recordingId: rec.id,
                type: a.type,
                startMs: a.startMs,
                endMs: a.endMs,
                space: a.space,
                geometry: a.geometry as Prisma.InputJsonValue,
                style: a.style,
                label: a.label ?? null,
                provenance: "AUTOMATIC",
                schemaVersion: ANNOTATION_SCHEMA_VERSION,
              })),
            },
          },
        });
        n++;
      }
      return { value: n, note: `${n} proposition(s) enregistrée(s) en brouillon.` };
    });

    const partial = steps.some((s) => s.status === "warning");
    const status: "NEEDS_REVIEW" | "PARTIAL" | "SUCCEEDED" = created > 0 ? "NEEDS_REVIEW" : partial ? "PARTIAL" : "SUCCEEDED";
    await notify(rec.ownerId, {
      type: "analysis_done",
      title: "Analyse assistée terminée",
      body: created > 0 ? `« ${rec.title} » : ${created} proposition(s) à valider.` : `« ${rec.title} » : aucune séquence détectée.`,
      link: `/app/videos/${rec.id}`,
    });
    return { status, result: { version: RULES_VERSION, contextSec, steps, created, warnings: out.warnings, baselines: out.baselines, sampling: out.sampling } };
  } catch (e) {
    // Trace des étapes conservée même en cas d'échec.
    await prisma.analysisJob.update({ where: { id: job.id }, data: { result: { version: RULES_VERSION, contextSec, steps } } }).catch(() => {});
    throw e;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
