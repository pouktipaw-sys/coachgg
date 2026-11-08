import Link from "next/link";
import { notFound } from "next/navigation";
import { CoachingStudio } from "@/components/video/CoachingStudio";
import { RecordingStatusPanel } from "@/components/video/RecordingStatusPanel";
import { RecordingSettings } from "@/components/video/RecordingSettings";
import { AnalysisPanel, type AnalysisJobDTO } from "@/components/video/AnalysisPanel";
import { EvaluationPanel } from "@/components/video/EvaluationPanel";
import { integrationStatus } from "@/lib/env";
import { Badge, PageHeader, RECORDING_STATUS } from "@/components/ui";
import type { AnnotationDTO, RecommendationDTO, RecordingDTO } from "@/components/video/types";
import { requirePageUser } from "@/server/auth/page";
import { HttpError } from "@/server/errors";
import { getCoachingData } from "@/server/video/coaching";
import { userMatchOptions } from "@/server/matches/queries";
import { prisma } from "@/server/db";

export const metadata = { title: "Lecteur de coaching" };

const toPlain = <T,>(x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v))) as T;

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  let data;
  try {
    data = await getCoachingData(user.id, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const isOwner = data.access === "owner";
  const rec = data.recording;
  const st = RECORDING_STATUS[rec.status]!;
  const analysisJob = isOwner
    ? await prisma.analysisJob.findFirst({
        where: { recordingId: id, type: "ANALYZE_RECORDING" },
        select: { id: true, status: true, progress: true, attempts: true, maxAttempts: true, error: true, processingMs: true, costMicros: true, finishedAt: true, result: true },
      })
    : null;
  const [matches, teams, shares] = isOwner
    ? await Promise.all([
        userMatchOptions(user.id),
        prisma.team.findMany({ where: { memberships: { some: { userId: user.id } } }, select: { id: true, name: true } }),
        prisma.sharePermission.findMany({
          where: { recordingId: id, revokedAt: null },
          include: { granteeTeam: { select: { name: true } }, granteeUser: { select: { displayName: true } } },
        }),
      ])
    : [[], [], []];

  return (
    <div>
      <PageHeader
        title={rec.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            {isOwner ? <Badge>Privée sauf partage explicite</Badge> : <Badge tone="info">Partagée par {rec.owner.displayName}</Badge>}
            {rec.match && <Link className="underline" href={`/app/matches/${rec.match.id}`}>Voir le rapport du match</Link>}
          </span>
        }
        actions={<Link href="/app/videos" className="btn-ghost">← Bibliothèque</Link>}
      />
      {rec.status === "READY" ? (
        <CoachingStudio
          key={`${analysisJob?.finishedAt?.getTime() ?? 0}`}
          recording={toPlain<RecordingDTO>(rec)}
          initialMoments={toPlain<RecommendationDTO[]>(data.recommendations)}
          initialAnnotations={toPlain<AnnotationDTO[]>(data.annotations)}
          isOwner={isOwner}
        />
      ) : (
        <RecordingStatusPanel id={rec.id} status={rec.status} errorMessage={rec.errorMessage} isOwner={isOwner} />
      )}
      {isOwner && rec.status === "READY" && (
        <div className="mt-6">
          <AnalysisPanel recordingId={rec.id} initial={toPlain<AnalysisJobDTO>(analysisJob)} />
        </div>
      )}
      {isOwner && rec.status === "READY" && (
        <div className="mt-6">
          <EvaluationPanel
            key={`eval-${analysisJob?.status ?? "none"}-${analysisJob?.finishedAt?.getTime() ?? 0}`}
            recordingId={rec.id}
            riotReady={
              integrationStatus().riotApi !== "configured"
                ? { ok: false, reason: "clé API Riot non configurée sur le serveur." }
                : rec.match?.source !== "RIOT_API"
                  ? { ok: false, reason: "vidéo non liée à un match importé via l'API Riot." }
                  : rec.gameStartOffsetMs == null
                    ? { ok: false, reason: "vidéo non synchronisée avec l'horloge du jeu (onglet « Synchro »)." }
                    : { ok: true }
            }
          />
        </div>
      )}
      {isOwner && (
        <RecordingSettings
          recording={{ id: rec.id, title: rec.title, matchId: rec.matchId }}
          matches={matches}
          teams={teams}
          shares={shares.map((s) => ({ id: s.id, label: s.granteeTeam ? `Groupe ${s.granteeTeam.name}` : s.granteeUser?.displayName ?? "?" }))}
        />
      )}
    </div>
  );
}
