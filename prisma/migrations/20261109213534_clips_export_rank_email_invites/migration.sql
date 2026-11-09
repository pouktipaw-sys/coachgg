-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'EXPORT_CLIP';

-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "exportError" TEXT,
ADD COLUMN     "exportKey" TEXT,
ADD COLUMN     "exportStatus" TEXT,
ADD COLUMN     "exportedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "GameIdentity" ADD COLUMN     "rank" JSONB,
ADD COLUMN     "rankFetchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TeamEmailInvite" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "TeamEmailInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamEmailInvite_email_idx" ON "TeamEmailInvite"("email");

-- CreateIndex
CREATE INDEX "TeamEmailInvite_teamId_idx" ON "TeamEmailInvite"("teamId");

-- CreateIndex
CREATE INDEX "Clip_ownerId_createdAt_idx" ON "Clip"("ownerId", "createdAt");
