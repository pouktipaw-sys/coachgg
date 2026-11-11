// Votes entre coéquipiers d'une partie : seuls les joueurs liés à la partie votent,
// uniquement pour leurs coéquipiers (même équipe, pas eux-mêmes).
import { z } from "zod";
import { prisma } from "./db";
import { badRequest, forbidden, notFound } from "./errors";
import { canViewMatch } from "./permissions";
import { notify } from "./notifications";
import { tallyVotes, validateBallot } from "@/lib/votes";

export const ballotSchema = z.object({
  votes: z
    .array(
      z.object({
        targetId: z.string(),
        score: z.number().int().min(1).max(10),
        mvp: z.boolean().default(false),
        awards: z.array(z.string()).max(6).default([]),
      }),
    )
    .max(4),
});

const name = (p: { riotGameName: string | null; riotTagLine: string | null; championName: string; user?: { displayName: string } | null }) =>
  p.user?.displayName ?? (p.riotGameName ? `${p.riotGameName}${p.riotTagLine ? `#${p.riotTagLine}` : ""}` : p.championName);

/** Données du panneau de vote : coéquipiers, mon bulletin, résultats par équipe. */
export async function voteBoard(userId: string, matchId: string) {
  if (!(await canViewMatch(userId, matchId))) throw notFound("Match");
  const [participants, votes] = await Promise.all([
    prisma.matchParticipant.findMany({
      where: { matchId },
      select: { id: true, userId: true, teamSide: true, championName: true, role: true, riotGameName: true, riotTagLine: true, win: true, user: { select: { displayName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.peerVote.findMany({ where: { matchId } }),
  ]);
  const me = participants.find((p) => p.userId === userId) ?? null;
  const sides = [100, 200].filter((s) => participants.some((p) => p.teamSide === s));
  const results = sides
    .map((side) => {
      const ids = participants.filter((p) => p.teamSide === side).map((p) => p.id);
      return { side, tally: tallyVotes(votes.filter((v) => ids.includes(v.targetId))) };
    })
    .filter((r) => r.tally.voters > 0 || r.side === me?.teamSide);
  return {
    me: me ? { id: me.id, side: me.teamSide } : null,
    mates: me ? participants.filter((p) => p.teamSide === me.teamSide && p.id !== me.id).map((p) => ({ id: p.id, name: name(p), championName: p.championName, role: p.role, hasAccount: !!p.userId })) : [],
    names: Object.fromEntries(participants.map((p) => [p.id, `${name(p)} (${p.championName})`])),
    myBallot: votes.filter((v) => v.voterId === userId).map((v) => ({ targetId: v.targetId, score: v.score, mvp: v.mvp, awards: v.awards })),
    results,
  };
}

/** Enregistre (ou remplace) le bulletin de l'utilisateur pour cette partie. */
export async function submitBallot(userId: string, matchId: string, raw: unknown) {
  const { votes } = ballotSchema.parse(raw);
  const participants = await prisma.matchParticipant.findMany({ where: { matchId }, select: { id: true, userId: true, teamSide: true } });
  if (!participants.length) throw notFound("Match");
  const me = participants.find((p) => p.userId === userId);
  if (!me) throw forbidden("Seuls les joueurs de la partie peuvent voter.");
  const mates = participants.filter((p) => p.teamSide === me.teamSide && p.id !== me.id);
  const error = validateBallot(votes, mates.map((m) => m.id));
  if (error) throw badRequest(error);
  const first = (await prisma.peerVote.count({ where: { matchId, voterId: userId } })) === 0;
  await prisma.$transaction([
    prisma.peerVote.deleteMany({ where: { matchId, voterId: userId } }),
    prisma.peerVote.createMany({ data: votes.map((v) => ({ matchId, voterId: userId, targetId: v.targetId, score: v.score, mvp: v.mvp, awards: v.awards })) }),
  ]);
  // Premier vote : les coéquipiers qui ont un compte CoachGG et n'ont pas encore voté sont prévenus.
  if (first && votes.length) {
    const voted = new Set((await prisma.peerVote.findMany({ where: { matchId }, select: { voterId: true }, distinct: ["voterId"] })).map((v) => v.voterId));
    for (const m of mates) {
      if (m.userId && !voted.has(m.userId))
        await notify(m.userId, { type: "peer_vote", title: "Élection du MVP", body: "Un coéquipier a noté la partie : donnez vos notes et votez pour le MVP.", link: `/app/matches/${matchId}#votes` });
    }
  }
  return voteBoard(userId, matchId);
}
