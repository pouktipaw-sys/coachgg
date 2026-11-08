-- CreateEnum
CREATE TYPE "GroundTruthSource" AS ENUM ('MANUAL', 'RIOT_TIMELINE');

-- CreateTable
CREATE TABLE "GroundTruthEvent" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DEATH',
    "videoMs" INTEGER NOT NULL,
    "source" "GroundTruthSource" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroundTruthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroundTruthEvent_recordingId_type_idx" ON "GroundTruthEvent"("recordingId", "type");

-- AddForeignKey
ALTER TABLE "GroundTruthEvent" ADD CONSTRAINT "GroundTruthEvent_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
