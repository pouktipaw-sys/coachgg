ALTER TABLE "MatchStatistics" ADD COLUMN "runes" JSONB;
CREATE TABLE "RiotMatchCache" ("riotMatchId" TEXT NOT NULL, "data" JSONB NOT NULL, "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "RiotMatchCache_pkey" PRIMARY KEY ("riotMatchId"));
