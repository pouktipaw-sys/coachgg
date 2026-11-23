ALTER TABLE "PlayerProfile" ADD COLUMN "publicProfile" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlayerProfile" ADD COLUMN "publicSlug" TEXT;
CREATE UNIQUE INDEX "PlayerProfile_publicSlug_key" ON "PlayerProfile"("publicSlug");
