// Politique de conservation : purge des vidéos plus anciennes que le délai choisi
// par l'utilisateur (PlayerProfile.retentionDays). Exécutée par le worker.
import { prisma } from "./db";
import { storage, recordingPrefix } from "./storage";

export async function purgeExpiredRecordings(now = new Date()) {
  const profiles = await prisma.playerProfile.findMany({ where: { retentionDays: { not: null } }, select: { userId: true, retentionDays: true } });
  let deleted = 0;
  for (const p of profiles) {
    const cutoff = new Date(now.getTime() - p.retentionDays! * 86400_000);
    const old = await prisma.recording.findMany({ where: { ownerId: p.userId, createdAt: { lt: cutoff } }, select: { id: true, ownerId: true } });
    for (const r of old) {
      await prisma.analysisJob.updateMany({ where: { recordingId: r.id, status: { in: ["PENDING", "RUNNING"] } }, data: { cancelRequested: true } });
      await storage().deletePrefix(recordingPrefix(r.ownerId, r.id));
      await prisma.recording.delete({ where: { id: r.id } });
      deleted++;
    }
  }
  // Envois abandonnés depuis plus de 7 jours : libère l'espace disque.
  const stale = await prisma.recording.findMany({
    where: { status: "UPLOADING", updatedAt: { lt: new Date(now.getTime() - 7 * 86400_000) } },
    select: { id: true, ownerId: true },
  });
  for (const r of stale) {
    await storage().deletePrefix(recordingPrefix(r.ownerId, r.id));
    await prisma.recording.delete({ where: { id: r.id } });
    deleted++;
  }
  return deleted;
}
