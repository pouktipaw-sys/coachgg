// Tâche PROCESS_RECORDING : validation → métadonnées → MP4 lisible → miniature.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnalysisJob } from "@prisma/client";
import { prisma } from "../db";
import { storage, recordingPrefix } from "../storage";
import { env } from "@/lib/env";
import { JobCancelledError, PermanentJobError, setJobProgress } from "../jobs";
import { MediaError, makePlayback, makeThumbnail, probe } from "./ffmpeg";
import { notify } from "../notifications";

export async function processRecording(job: AnalysisJob) {
  if (!job.recordingId) throw new PermanentJobError("Tâche sans vidéo associée.");
  const rec = await prisma.recording.findUnique({ where: { id: job.recordingId } });
  if (!rec) throw new JobCancelledError("Vidéo supprimée.");
  if (rec.status === "READY" && rec.playbackKey) return { skipped: "already_ready" }; // idempotent

  await prisma.recording.update({ where: { id: rec.id }, data: { status: "PROCESSING", errorMessage: null } });
  const st = storage();
  const tmp = await mkdtemp(path.join(os.tmpdir(), "coachgg-"));
  const abort = new AbortController();
  try {
    const input = st.localPath(rec.originalKey);
    let meta;
    try {
      meta = await probe(input);
    } catch (e) {
      throw new PermanentJobError(e instanceof Error ? e.message : "Fichier invalide.");
    }
    if (meta.durationMs > env.maxVideoDurationSec * 1000)
      throw new PermanentJobError(`Vidéo trop longue (max ${Math.round(env.maxVideoDurationSec / 60)} min).`);
    if (meta.width > 7680 || meta.height > 4320) throw new PermanentJobError("Résolution non prise en charge.");
    await setJobProgress(job.id, 5);

    const out = path.join(tmp, "playback.mp4");
    let lastReport = 0;
    let pending: Promise<void> | null = null;
    let cancelled = false;
    const { remuxed } = await makePlayback(input, out, meta, {
      signal: abort.signal,
      onProgress: (pct) => {
        if (Date.now() - lastReport < 2000 || pending) return;
        lastReport = Date.now();
        pending = setJobProgress(job.id, 5 + pct * 0.85)
          .catch((e) => {
            if (e instanceof JobCancelledError || (e as { code?: string })?.code === "P2025") {
              cancelled = true;
              abort.abort();
            }
          })
          .finally(() => (pending = null));
      },
    }).catch((e) => {
      if (cancelled) throw new JobCancelledError("Traitement annulé.");
      if (e instanceof MediaError) throw new PermanentJobError(e.message);
      throw e;
    });

    const thumb = path.join(tmp, "thumb.jpg");
    let thumbOk = true;
    try {
      await makeThumbnail(out, thumb, meta.durationMs);
    } catch {
      thumbOk = false; // miniature facultative : ne bloque pas la lecture
    }

    // La vidéo a pu être supprimée pendant le traitement.
    const still = await prisma.recording.findUnique({ where: { id: rec.id }, select: { id: true } });
    if (!still) throw new JobCancelledError("Vidéo supprimée pendant le traitement.");

    const prefix = recordingPrefix(rec.ownerId, rec.id);
    await st.importFile(`${prefix}playback.mp4`, out);
    if (thumbOk) await st.importFile(`${prefix}thumb.jpg`, thumb);
    // L'original n'est conservé que s'il diffère réellement du fichier de lecture.
    if (remuxed) await st.delete(rec.originalKey);

    await prisma.recording.update({
      where: { id: rec.id },
      data: {
        status: "READY",
        playbackKey: `${prefix}playback.mp4`,
        thumbnailKey: thumbOk ? `${prefix}thumb.jpg` : null,
        originalKey: remuxed ? `${prefix}playback.mp4` : rec.originalKey,
        durationMs: meta.durationMs,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        videoCodec: meta.videoCodec,
      },
    });
    await notify(rec.ownerId, {
      type: "recording_ready",
      title: "Vidéo prête",
      body: `« ${rec.title} » est prête pour le coaching.`,
      link: `/app/videos/${rec.id}`,
    });
    return { ...meta, remuxed, thumbnail: thumbOk };
  } finally {
    await rm(tmp, { recursive: true, force: true }); // nettoyage systématique des fichiers temporaires
  }
}

/** Appelé quand la tâche échoue définitivement. */
export async function markRecordingFailed(recordingId: string, message: string) {
  const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!rec) return;
  await prisma.recording.update({ where: { id: recordingId }, data: { status: "FAILED", errorMessage: message } });
  await notify(rec.ownerId, {
    type: "recording_failed",
    title: "Échec du traitement vidéo",
    body: `« ${rec.title} » : ${message}`,
    link: `/app/videos/${rec.id}`,
  });
}
