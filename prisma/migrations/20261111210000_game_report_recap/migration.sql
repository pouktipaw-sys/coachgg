-- Bilan écrit et vidéo récap d'une partie analysée
ALTER TYPE "JobType" ADD VALUE 'RENDER_RECAP';
ALTER TABLE "Recording" ADD COLUMN "gameReport" JSONB;
ALTER TABLE "Recording" ADD COLUMN "recapKey" TEXT;
ALTER TABLE "Recording" ADD COLUMN "recapStatus" TEXT;
ALTER TABLE "Recording" ADD COLUMN "recapError" TEXT;
ALTER TABLE "Recording" ADD COLUMN "recapAt" TIMESTAMP(3);
