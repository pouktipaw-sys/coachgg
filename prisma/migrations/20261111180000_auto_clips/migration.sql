-- Découpage automatique des séquences détectées en clips
ALTER TYPE "MomentKind" ADD VALUE 'DEATH';
ALTER TABLE "PlayerProfile" ADD COLUMN "autoClipDeaths" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PlayerProfile" ADD COLUMN "autoClipFights" BOOLEAN NOT NULL DEFAULT false;
