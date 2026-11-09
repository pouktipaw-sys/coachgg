// Visionnage synchronisé : vidéos d'un même match visibles par l'utilisateur.
// Seules les vidéos que l'utilisateur peut déjà voir (les siennes ou partagées explicitement)
// sont incluses : appartenir à un groupe ne donne pas accès aux vidéos privées.
import { prisma } from "../db";
import { notFound } from "../errors";
import { canViewMatch, visibleRecordingWhere } from "../permissions";

export async function syncSession(userId: string, matchId: string) {
  if (!(await canViewMatch(userId, matchId))) throw notFound("Match");
  const recs = await prisma.recording.findMany({
    where: { matchId, status: "READY", playbackKey: { not: null }, ...visibleRecordingWhere(userId) },
    orderBy: { createdAt: "asc" },
    include: {
      owner: { select: { id: true, displayName: true } },
      recommendations: { where: { status: { in: ["PUBLISHED", "DISPUTED"] } }, orderBy: { decisionMs: "asc" }, select: { id: true, title: true, decisionMs: true } },
    },
  });
  const tracks = recs
    .filter((r) => r.gameStartOffsetMs != null && r.durationMs != null)
    .map((r) => ({
      id: r.id,
      title: r.title,
      ownerName: r.owner.displayName,
      mine: r.ownerId === userId,
      gameStartOffsetMs: r.gameStartOffsetMs!,
      durationMs: r.durationMs!,
      moments: r.recommendations.map((m) => ({ id: m.id, title: m.title, gameMs: m.decisionMs - r.gameStartOffsetMs! })),
    }));
  const unsynced = recs
    .filter((r) => r.gameStartOffsetMs == null || r.durationMs == null)
    .map((r) => ({ id: r.id, title: r.title, mine: r.ownerId === userId, ownerName: r.owner.displayName }));
  return { tracks, unsynced };
}
