-- CreateTable
CREATE TABLE "CoachThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "missingInformation" JSONB,
    "followUps" JSONB,
    "mode" TEXT,
    "model" TEXT,
    "sourcesCount" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "costMicros" INTEGER,
    "latencyMs" INTEGER,
    "warning" TEXT,
    "reportedAt" TIMESTAMP(3),
    "reportComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachThread_userId_updatedAt_idx" ON "CoachThread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CoachMessage_threadId_createdAt_idx" ON "CoachMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "CoachThread" ADD CONSTRAINT "CoachThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CoachThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
