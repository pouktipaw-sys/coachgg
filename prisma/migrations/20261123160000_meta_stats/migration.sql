ALTER TYPE "JobType" ADD VALUE 'META_CRAWL';
CREATE TABLE "MetaMatch" ("riotMatchId" TEXT NOT NULL, "platform" TEXT NOT NULL, "patch" TEXT NOT NULL, "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MetaMatch_pkey" PRIMARY KEY ("riotMatchId"));
CREATE INDEX "MetaMatch_patch_idx" ON "MetaMatch"("patch");
CREATE TABLE "MetaPatch" ("patch" TEXT NOT NULL, "games" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "MetaPatch_pkey" PRIMARY KEY ("patch"));
CREATE TABLE "MetaChampionStat" ("patch" TEXT NOT NULL, "championId" INTEGER NOT NULL, "role" TEXT NOT NULL, "games" INTEGER NOT NULL DEFAULT 0, "wins" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "MetaChampionStat_pkey" PRIMARY KEY ("patch","championId","role"));
CREATE TABLE "MetaBan" ("patch" TEXT NOT NULL, "championId" INTEGER NOT NULL, "bans" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "MetaBan_pkey" PRIMARY KEY ("patch","championId"));
CREATE TABLE "MetaItemStat" ("patch" TEXT NOT NULL, "championId" INTEGER NOT NULL, "role" TEXT NOT NULL, "itemId" INTEGER NOT NULL, "games" INTEGER NOT NULL DEFAULT 0, "wins" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "MetaItemStat_pkey" PRIMARY KEY ("patch","championId","role","itemId"));
CREATE TABLE "MetaRunePage" ("patch" TEXT NOT NULL, "championId" INTEGER NOT NULL, "role" TEXT NOT NULL, "pageKey" TEXT NOT NULL, "games" INTEGER NOT NULL DEFAULT 0, "wins" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "MetaRunePage_pkey" PRIMARY KEY ("patch","championId","role","pageKey"));
CREATE TABLE "MetaMatchup" ("patch" TEXT NOT NULL, "championId" INTEGER NOT NULL, "role" TEXT NOT NULL, "opponentId" INTEGER NOT NULL, "games" INTEGER NOT NULL DEFAULT 0, "wins" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "MetaMatchup_pkey" PRIMARY KEY ("patch","championId","role","opponentId"));
