-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "IdentityVerification" AS ENUM ('DECLARED', 'VERIFIED_RSO');

-- CreateEnum
CREATE TYPE "ExplanationLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "LolRole" AS ENUM ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY');

-- CreateEnum
CREATE TYPE "MatchSource" AS ENUM ('MANUAL', 'RIOT_API', 'DEMO');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordingSource" AS ENUM ('MANUAL_UPLOAD', 'DESKTOP_CAPTURE');

-- CreateEnum
CREATE TYPE "MomentKind" AS ENUM ('MISTAKE', 'GOOD_ACTION', 'OBJECTIVE', 'FIGHT', 'MISSED_OPPORTUNITY', 'INTERESTING');

-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('PROCESS_RECORDING', 'ANALYZE_RECORDING', 'COMPUTE_SCORES');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'NEEDS_REVIEW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "AnalysisCategory" AS ENUM ('POSITIONING', 'MOVEMENT', 'ENGAGEMENT', 'ALLY_SUPPORT', 'RESOURCES', 'ABILITIES', 'VISION', 'ROTATIONS', 'OBJECTIVES', 'COORDINATION');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CoordinateSpace" AS ENUM ('FRAME', 'MINIMAP');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('INCORRECT', 'UNCLEAR', 'HELPFUL', 'CORRECTION');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ABANDONED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'riot',
    "gameName" TEXT NOT NULL,
    "tagLine" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "puuid" TEXT,
    "verification" "IdentityVerification" NOT NULL DEFAULT 'DECLARED',
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "primaryRole" "LolRole",
    "secondaryRole" "LolRole",
    "favoriteChampions" TEXT[],
    "progressGoal" TEXT,
    "explanationLevel" "ExplanationLevel" NOT NULL DEFAULT 'INTERMEDIATE',
    "explanationDensity" TEXT NOT NULL DEFAULT 'normal',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "defaultVideoPrivate" BOOLEAN NOT NULL DEFAULT true,
    "shareStatsWithTeams" BOOLEAN NOT NULL DEFAULT true,
    "retentionDays" INTEGER,
    "onboardingCompletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "source" "MatchSource" NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "riotMatchId" TEXT,
    "platform" TEXT,
    "queueId" INTEGER,
    "gameMode" TEXT,
    "gameStartAt" TIMESTAMP(3),
    "durationSec" INTEGER NOT NULL,
    "gameVersion" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamStats" JSONB,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT,
    "puuid" TEXT,
    "riotGameName" TEXT,
    "riotTagLine" TEXT,
    "championName" TEXT NOT NULL,
    "role" "LolRole",
    "teamSide" INTEGER NOT NULL,
    "win" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchStatistics" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "creepScore" INTEGER,
    "goldEarned" INTEGER,
    "damageToChampions" INTEGER,
    "damageToObjectives" INTEGER,
    "visionScore" INTEGER,
    "wardsPlaced" INTEGER,
    "wardsKilled" INTEGER,
    "controlWardsBought" INTEGER,
    "objectivesTakedowns" INTEGER,
    "items" INTEGER[],
    "timeline" JSONB,

    CONSTRAINT "MatchStatistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "matchId" TEXT,
    "source" "RecordingSource" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "status" "RecordingStatus" NOT NULL DEFAULT 'UPLOADING',
    "title" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "declaredMime" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "receivedBytes" BIGINT NOT NULL DEFAULT 0,
    "originalKey" TEXT NOT NULL,
    "playbackKey" TEXT,
    "thumbnailKey" TEXT,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "videoCodec" TEXT,
    "gameStartOffsetMs" INTEGER,
    "minimapRegion" JSONB,
    "errorMessage" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "MomentKind" NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "personalNote" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisJob" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "recordingId" TEXT,
    "matchId" TEXT,
    "version" TEXT NOT NULL DEFAULT '1',
    "payload" JSONB,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "processingMs" INTEGER,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT,
    "matchId" TEXT,
    "recommendationId" TEXT,
    "analysisJobId" TEXT,
    "timeMs" INTEGER,
    "category" "AnalysisCategory",
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" "Provenance" NOT NULL,
    "authorId" TEXT,
    "analysisVersion" TEXT NOT NULL DEFAULT 'manual-1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "clipId" TEXT,
    "authorId" TEXT,
    "kind" "MomentKind" NOT NULL,
    "category" "AnalysisCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "contextStartMs" INTEGER NOT NULL,
    "slowdownStartMs" INTEGER NOT NULL,
    "decisionMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "slowdownRate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "interpretation" TEXT NOT NULL,
    "alternatives" JSONB NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "confidenceReason" TEXT NOT NULL,
    "advice" TEXT NOT NULL,
    "provenance" "Provenance" NOT NULL DEFAULT 'MANUAL',
    "analysisVersion" TEXT NOT NULL DEFAULT 'manual-1',
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAnnotation" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "type" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "space" "CoordinateSpace" NOT NULL DEFAULT 'FRAME',
    "geometry" JSONB NOT NULL,
    "style" TEXT NOT NULL,
    "label" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'MANUAL',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "scoreId" TEXT,
    "kind" "FeedbackKind" NOT NULL,
    "comment" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreVersion" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "experimental" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceScore" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "scoreVersionId" TEXT NOT NULL,
    "overall" DOUBLE PRECISION,
    "components" JSONB NOT NULL,
    "positives" JSONB NOT NULL,
    "negatives" JSONB NOT NULL,
    "missingData" JSONB NOT NULL,
    "reliability" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMatchReport" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "scoreVersionId" TEXT NOT NULL,
    "presentUserIds" TEXT[],
    "mvpUserIds" TEXT[],
    "isTie" BOOLEAN NOT NULL DEFAULT false,
    "explanation" JSONB NOT NULL,
    "distinctions" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMatchReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharePermission" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "granteeUserId" TEXT,
    "granteeTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SharePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "teamId" TEXT,
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "expectedBehavior" TEXT,
    "metric" JSONB,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3),
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "review" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "GameIdentity_gameName_tagLine_idx" ON "GameIdentity"("gameName", "tagLine");

-- CreateIndex
CREATE INDEX "GameIdentity_puuid_idx" ON "GameIdentity"("puuid");

-- CreateIndex
CREATE UNIQUE INDEX "GameIdentity_userId_provider_gameName_tagLine_key" ON "GameIdentity"("userId", "provider", "gameName", "tagLine");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_userId_key" ON "PlayerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_riotMatchId_key" ON "Match"("riotMatchId");

-- CreateIndex
CREATE INDEX "Match_createdById_idx" ON "Match"("createdById");

-- CreateIndex
CREATE INDEX "MatchParticipant_matchId_idx" ON "MatchParticipant"("matchId");

-- CreateIndex
CREATE INDEX "MatchParticipant_userId_idx" ON "MatchParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchStatistics_participantId_key" ON "MatchStatistics"("participantId");

-- CreateIndex
CREATE INDEX "Recording_ownerId_createdAt_idx" ON "Recording"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Recording_matchId_idx" ON "Recording"("matchId");

-- CreateIndex
CREATE INDEX "Clip_recordingId_idx" ON "Clip"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJob_idempotencyKey_key" ON "AnalysisJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AnalysisJob_status_runAfter_idx" ON "AnalysisJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "AnalysisJob_recordingId_idx" ON "AnalysisJob"("recordingId");

-- CreateIndex
CREATE INDEX "Observation_recommendationId_idx" ON "Observation"("recommendationId");

-- CreateIndex
CREATE INDEX "Observation_recordingId_idx" ON "Observation"("recordingId");

-- CreateIndex
CREATE INDEX "Recommendation_recordingId_decisionMs_idx" ON "Recommendation"("recordingId", "decisionMs");

-- CreateIndex
CREATE INDEX "VideoAnnotation_recordingId_startMs_idx" ON "VideoAnnotation"("recordingId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceScore_participantId_scoreVersionId_key" ON "PerformanceScore"("participantId", "scoreVersionId");

-- CreateIndex
CREATE INDEX "TeamMembership_userId_idx" ON "TeamMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_teamId_userId_key" ON "TeamMembership"("teamId", "userId");

-- CreateIndex
CREATE INDEX "TeamInvitation_inviteeId_status_idx" ON "TeamInvitation"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "TeamInvitation_teamId_idx" ON "TeamInvitation"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMatchReport_teamId_matchId_scoreVersionId_key" ON "TeamMatchReport"("teamId", "matchId", "scoreVersionId");

-- CreateIndex
CREATE INDEX "SharePermission_recordingId_idx" ON "SharePermission"("recordingId");

-- CreateIndex
CREATE INDEX "SharePermission_granteeUserId_idx" ON "SharePermission"("granteeUserId");

-- CreateIndex
CREATE INDEX "SharePermission_granteeTeamId_idx" ON "SharePermission"("granteeTeamId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameIdentity" ADD CONSTRAINT "GameIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchStatistics" ADD CONSTRAINT "MatchStatistics_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "AnalysisJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnnotation" ADD CONSTRAINT "VideoAnnotation_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnnotation" ADD CONSTRAINT "VideoAnnotation_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnnotation" ADD CONSTRAINT "VideoAnnotation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisFeedback" ADD CONSTRAINT "AnalysisFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisFeedback" ADD CONSTRAINT "AnalysisFeedback_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceScore" ADD CONSTRAINT "PerformanceScore_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceScore" ADD CONSTRAINT "PerformanceScore_scoreVersionId_fkey" FOREIGN KEY ("scoreVersionId") REFERENCES "ScoreVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMatchReport" ADD CONSTRAINT "TeamMatchReport_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMatchReport" ADD CONSTRAINT "TeamMatchReport_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMatchReport" ADD CONSTRAINT "TeamMatchReport_scoreVersionId_fkey" FOREIGN KEY ("scoreVersionId") REFERENCES "ScoreVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePermission" ADD CONSTRAINT "SharePermission_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePermission" ADD CONSTRAINT "SharePermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePermission" ADD CONSTRAINT "SharePermission_granteeUserId_fkey" FOREIGN KEY ("granteeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePermission" ADD CONSTRAINT "SharePermission_granteeTeamId_fkey" FOREIGN KEY ("granteeTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
