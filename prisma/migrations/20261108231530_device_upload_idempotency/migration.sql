-- Clé d'idempotence des envois de l'application PC
ALTER TABLE "Recording" ADD COLUMN "clientUploadId" TEXT;
CREATE UNIQUE INDEX "Recording_deviceId_clientUploadId_key" ON "Recording"("deviceId", "clientUploadId");
