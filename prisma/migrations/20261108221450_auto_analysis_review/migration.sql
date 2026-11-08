-- AlterEnum
ALTER TYPE "RecommendationStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "analysisJobId" TEXT,
ADD COLUMN     "autoEvidence" JSONB,
ADD COLUMN     "contextSheetKey" TEXT,
ADD COLUMN     "humanEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;
