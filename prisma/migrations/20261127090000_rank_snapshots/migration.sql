CREATE TABLE "RankSnapshot" ("id" TEXT NOT NULL, "identityId" TEXT NOT NULL, "queue" TEXT NOT NULL, "tier" TEXT NOT NULL, "division" TEXT NOT NULL, "lp" INTEGER NOT NULL, "wins" INTEGER NOT NULL, "losses" INTEGER NOT NULL, "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "RankSnapshot_pkey" PRIMARY KEY ("id"));
CREATE INDEX "RankSnapshot_identityId_queue_at_idx" ON "RankSnapshot"("identityId", "queue", "at");
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "GameIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
