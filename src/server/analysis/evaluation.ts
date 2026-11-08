// Mesure de la précision de l'analyse assistée contre une vérité terrain.
import { prisma } from "../db";
import { HttpError, badRequest, notFound } from "../errors";
import { requireRecordingOwner } from "../permissions";
import { riotClient, type RiotClient } from "../riot/client";
import { aggregate, deathsFromTimeline, evaluateDetections, DEFAULT_TOLERANCE_MS, type EvalResult } from "@/lib/analysis/evaluation";

type Detection = { type: string; startMs: number; endMs: number; confidence: string };

export async function listGroundTruth(userId: string, recordingId: string) {
  await requireRecordingOwner(userId, recordingId);
  return prisma.groundTruthEvent.findMany({ where: { recordingId }, orderBy: { videoMs: "asc" } });
}

export async function addGroundTruth(userId: string, recordingId: string, videoMs: number) {
  await requireRecordingOwner(userId, recordingId);
  const rec = await prisma.recording.findUniqueOrThrow({ where: { id: recordingId }, select: { durationMs: true } });
  if (!Number.isInteger(videoMs) || videoMs < 0 || (rec.durationMs != null && videoMs > rec.durationMs)) throw badRequest("Horodatage hors de la vidéo.");
  const dup = await prisma.groundTruthEvent.findFirst({ where: { recordingId, source: "MANUAL", videoMs: { gte: videoMs - 1000, lte: videoMs + 1000 } } });
  if (dup) throw new HttpError(409, "duplicate", "Une mort est déjà marquée à moins d'une seconde.");
  return prisma.groundTruthEvent.create({ data: { recordingId, videoMs, source: "MANUAL", createdById: userId } });
}

export async function deleteGroundTruth(userId: string, id: string) {
  const ev = await prisma.groundTruthEvent.findUnique({ where: { id } });
  if (!ev) throw notFound("Événement");
  await requireRecordingOwner(userId, ev.recordingId);
  await prisma.groundTruthEvent.delete({ where: { id } });
}

/**
 * Importe les morts du joueur depuis la timeline MATCH-V5. Conditions : vidéo liée
 * à un match importé de Riot, synchronisée avec l'horloge du jeu, joueur identifié.
 */
export async function importRiotDeaths(userId: string, recordingId: string, client?: RiotClient) {
  await requireRecordingOwner(userId, recordingId);
  const rec = await prisma.recording.findUniqueOrThrow({
    where: { id: recordingId },
    include: { match: { include: { participants: { where: { userId }, select: { puuid: true } } } } },
  });
  if (!rec.match?.riotMatchId) throw badRequest("La vidéo doit être liée à un match importé via l'API Riot.");
  if (rec.gameStartOffsetMs == null) throw badRequest("Synchronisez d'abord la vidéo avec l'horloge du jeu (onglet « Synchro »).");
  const puuid = rec.match.participants[0]?.puuid;
  if (!puuid) throw badRequest("Vous n'êtes pas identifié comme participant de ce match.");
  const timeline = await (client ?? riotClient()).timeline(rec.match.riotMatchId);
  const deaths = deathsFromTimeline(timeline, puuid, rec.gameStartOffsetMs).filter((t) => rec.durationMs == null || t <= rec.durationMs);
  await prisma.$transaction([
    prisma.groundTruthEvent.deleteMany({ where: { recordingId, source: "RIOT_TIMELINE" } }),
    prisma.groundTruthEvent.createMany({ data: deaths.map((videoMs) => ({ recordingId, videoMs, source: "RIOT_TIMELINE" as const, createdById: userId })) }),
  ]);
  return { imported: deaths.length };
}

export type RecordingEvaluation =
  | { status: "ok"; version: string; truthSource: "RIOT_TIMELINE" | "MANUAL"; truthCount: number; toleranceMs: number; result: EvalResult }
  | { status: "no_analysis" | "no_truth" | "no_detections_stored"; message: string };

/** Évalue la dernière analyse d'une vidéo. La timeline Riot est prioritaire sur le marquage manuel. */
export async function evaluateRecording(recordingId: string, toleranceMs = DEFAULT_TOLERANCE_MS): Promise<RecordingEvaluation> {
  const [job, truths, rec] = await Promise.all([
    prisma.analysisJob.findFirst({ where: { recordingId, type: "ANALYZE_RECORDING", status: { in: ["SUCCEEDED", "PARTIAL", "NEEDS_REVIEW"] } } }),
    prisma.groundTruthEvent.findMany({ where: { recordingId, type: "DEATH" } }),
    prisma.recording.findUniqueOrThrow({ where: { id: recordingId }, select: { durationMs: true } }),
  ]);
  if (!job) return { status: "no_analysis", message: "Aucune analyse terminée pour cette vidéo." };
  const result = job.result as { version?: string; detections?: Detection[] } | null;
  if (!result?.detections) return { status: "no_detections_stored", message: "Analyse antérieure à l'évaluation : relancez-la pour enregistrer les détections." };
  const riot = truths.filter((t) => t.source === "RIOT_TIMELINE");
  const ref = riot.length ? riot : truths.filter((t) => t.source === "MANUAL");
  if (!ref.length) return { status: "no_truth", message: "Aucune vérité terrain : marquez les morts réelles ou importez-les depuis la timeline Riot." };
  const r = evaluateDetections(
    result.detections.filter((d) => d.type === "grey_screen"),
    ref.map((t) => ({ videoMs: t.videoMs })),
    { toleranceMs, rangeMs: { from: 0, to: rec.durationMs ?? Number.MAX_SAFE_INTEGER } },
  );
  return { status: "ok", version: result.version ?? "?", truthSource: riot.length ? "RIOT_TIMELINE" : "MANUAL", truthCount: ref.length, toleranceMs, result: r };
}

export async function evaluateRecordingForOwner(userId: string, recordingId: string) {
  await requireRecordingOwner(userId, recordingId);
  return evaluateRecording(recordingId);
}

/** Agrégat par version de règles, sur toutes les vidéos disposant d'une vérité terrain (comptes uniquement). */
export async function evaluationSummary() {
  const ids = (await prisma.groundTruthEvent.findMany({ distinct: ["recordingId"], select: { recordingId: true } })).map((g) => g.recordingId);
  const byVersion = new Map<string, { tp: number; fp: number; fn: number; meanOffsetMs: number | null }[]>();
  for (const id of ids) {
    const e = await evaluateRecording(id);
    if (e.status !== "ok") continue;
    byVersion.set(e.version, [...(byVersion.get(e.version) ?? []), e.result]);
  }
  return [...byVersion.entries()].map(([version, rs]) => ({ version, ...aggregate(rs) }));
}
