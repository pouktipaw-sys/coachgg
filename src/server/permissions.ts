// Contrôle d'accès serveur — source unique de vérité pour les vidéos et analyses.
//
// Règles :
//  • Le propriétaire a tous les droits sur ses enregistrements.
//  • Un autre utilisateur ne peut VOIR une vidéo que via un partage explicite
//    non révoqué : vers lui directement, ou vers un groupe dont il est
//    ACTUELLEMENT membre (un départ du groupe retire l'accès immédiatement).
//  • Être dans le même groupe ne donne jamais accès aux vidéos privées.
//  • Seul le propriétaire peut modifier (annotations, moments, partages, suppression).
//  • Le rôle ADMIN ne donne pas accès aux vidéos privées.
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { forbidden, notFound } from "./errors";

export type RecordingAccess = "owner" | "shared" | null;

export function sharedRecordingWhere(userId: string): Prisma.RecordingWhereInput {
  return {
    shares: {
      some: {
        revokedAt: null,
        OR: [{ granteeUserId: userId }, { granteeTeam: { memberships: { some: { userId } } } }],
      },
    },
  };
}

export function visibleRecordingWhere(userId: string): Prisma.RecordingWhereInput {
  return { OR: [{ ownerId: userId }, sharedRecordingWhere(userId)] };
}

export async function recordingAccess(userId: string, recordingId: string): Promise<RecordingAccess> {
  const rec = await prisma.recording.findUnique({ where: { id: recordingId }, select: { ownerId: true } });
  if (!rec) return null;
  if (rec.ownerId === userId) return "owner";
  const shared = await prisma.recording.count({ where: { id: recordingId, ...sharedRecordingWhere(userId) } });
  return shared > 0 ? "shared" : null;
}

/** Lève 404 (et non 403) si l'utilisateur ne peut pas voir : on ne révèle pas l'existence. */
export async function requireRecordingView(userId: string, recordingId: string) {
  const access = await recordingAccess(userId, recordingId);
  if (!access) throw notFound("Vidéo");
  return access;
}

export async function requireRecordingOwner(userId: string, recordingId: string) {
  const access = await recordingAccess(userId, recordingId);
  if (!access) throw notFound("Vidéo");
  if (access !== "owner") throw forbidden("Seul le propriétaire de la vidéo peut la modifier.");
}

export async function teamMembership(userId: string, teamId: string) {
  return prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } } });
}

export async function requireTeamMember(userId: string, teamId: string) {
  const m = await teamMembership(userId, teamId);
  if (!m) throw notFound("Groupe");
  return m;
}

export async function requireTeamAdmin(userId: string, teamId: string) {
  const m = await requireTeamMember(userId, teamId);
  if (m.role !== "ADMIN") throw forbidden("Action réservée aux administrateurs du groupe.");
  return m;
}

/**
 * Accès aux statistiques d'un match : participant lié, créateur du match,
 * ou membre d'un groupe commun avec un participant lié qui partage ses stats.
 */
export async function canViewMatch(userId: string, matchId: string): Promise<boolean> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { createdById: true, participants: { select: { userId: true } } },
  });
  if (!match) return false;
  if (match.createdById === userId) return true;
  const linked = match.participants.map((p) => p.userId).filter((x): x is string => !!x);
  if (linked.includes(userId)) return true;
  if (linked.length === 0) return false;
  const common = await prisma.teamMembership.count({
    where: {
      userId: { in: linked },
      user: { profile: { shareStatsWithTeams: true } },
      team: { memberships: { some: { userId } } },
    },
  });
  return common > 0;
}
