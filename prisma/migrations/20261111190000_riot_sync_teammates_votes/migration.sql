-- Historique Riot, coéquipiers suivis, votes entre coéquipiers
ALTER TYPE "JobType" ADD VALUE 'RIOT_SYNC';
ALTER TABLE "GameIdentity" ADD COLUMN "historySyncedAt" TIMESTAMP(3);

CREATE TABLE "Teammate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "tagLine" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "puuid" TEXT,
    "nickname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Teammate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Teammate_ownerId_gameName_tagLine_key" ON "Teammate"("ownerId", "gameName", "tagLine");
CREATE INDEX "Teammate_puuid_idx" ON "Teammate"("puuid");
ALTER TABLE "Teammate" ADD CONSTRAINT "Teammate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PeerVote" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "mvp" BOOLEAN NOT NULL DEFAULT false,
    "awards" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PeerVote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PeerVote_matchId_voterId_targetId_key" ON "PeerVote"("matchId", "voterId", "targetId");
CREATE INDEX "PeerVote_targetId_idx" ON "PeerVote"("targetId");
CREATE INDEX "PeerVote_voterId_idx" ON "PeerVote"("voterId");
ALTER TABLE "PeerVote" ADD CONSTRAINT "PeerVote_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PeerVote" ADD CONSTRAINT "PeerVote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PeerVote" ADD CONSTRAINT "PeerVote_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
