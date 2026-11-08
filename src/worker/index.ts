// Worker de traitements longs (processus séparé du serveur web).
// Lancement : npm run worker
import os from "node:os";
import type { AnalysisJob } from "@prisma/client";
import { prisma } from "../server/db";
import { claimNextJob, completeJob, failJob } from "../server/jobs";
import { markRecordingFailed, processRecording } from "../server/video/process";
import { purgeExpiredRecordings } from "../server/retention";

const workerId = `${os.hostname()}:${process.pid}`;
let stopping = false;

export async function runJob(job: AnalysisJob) {
  const t0 = Date.now();
  try {
    let result: unknown;
    switch (job.type) {
      case "PROCESS_RECORDING":
        result = await processRecording(job);
        break;
      default:
        throw new Error(`Type de tâche non pris en charge : ${job.type}`);
    }
    await completeJob(job, (result ?? {}) as object);
    log(job, `terminé en ${Date.now() - t0} ms`);
  } catch (e) {
    const outcome = await failJob(job, e).catch(() => "failed" as const);
    log(job, `${outcome} : ${e instanceof Error ? e.message : String(e)}`);
    if (outcome === "failed" && job.type === "PROCESS_RECORDING" && job.recordingId) {
      await markRecordingFailed(job.recordingId, e instanceof Error ? e.message : "Échec du traitement.");
    }
  }
}

function log(job: AnalysisJob, msg: string) {
  console.log(`[worker] ${job.type} ${job.id} (essai ${job.attempts}/${job.maxAttempts}) ${msg}`);
}

/** Traite les tâches disponibles puis rend la main (utilisé aussi par les tests). */
export async function drain(max = 100) {
  let n = 0;
  while (n < max) {
    const job = await claimNextJob(workerId);
    if (!job) break;
    await runJob(job);
    n++;
  }
  return n;
}

async function main() {
  console.log(`[worker] démarré (${workerId})`);
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));
  let lastPurge = 0;
  while (!stopping) {
    if (Date.now() - lastPurge > 3600_000) {
      lastPurge = Date.now();
      await purgeExpiredRecordings()
        .then((n) => n && console.log(`[worker] conservation : ${n} vidéo(s) purgée(s)`))
        .catch((e) => console.error("[worker] purge échouée :", e instanceof Error ? e.message : e));
    }
    const n = await drain(10).catch((e) => {
      console.error("[worker] erreur de boucle :", e instanceof Error ? e.message : e);
      return 0;
    });
    if (n === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  await prisma.$disconnect();
  console.log("[worker] arrêté");
}

if (process.argv[1] && /worker[\\/]index\.ts$/.test(process.argv[1])) {
  void main();
}
