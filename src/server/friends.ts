// Amis : demande envoyée via le Riot ID d'un joueur. S'il a un compte CoachGG, il reçoit la demande ;
// dans tous les cas le joueur est ajouté à vos « joueurs suivis ». La réponse ne révèle pas
// si un Riot ID possède un compte. Accepter = partager un résumé : rang, forme, badges, classement.
import { prisma } from "./db";
import { HttpError, badRequest, notFound } from "./errors";
import { notify } from "./notifications";
import { addTeammate, teammateSchema } from "./teammates";
import { badges, form, streak, type GameLite } from "@/lib/badges";
import { CURRENT_SCORE_CONFIG } from "@/lib/scoring/config";

const GENERIC = "Demande envoyée ! Si ce joueur a un compte CoachGG, il la verra dans ses demandes d'ami. Il a aussi été ajouté à vos joueurs suivis.";

export async function sendFriendRequest(userId: string, raw: unknown) {
  const input = teammateSchema.parse(raw);
  const [gameName, tagLine] = input.riotId.split("#") as [string, string];
  const own = await prisma.gameIdentity.findFirst({
    where: { userId, gameName: { equals: gameName, mode: "insensitive" }, tagLine: { equals: tagLine, mode: "insensitive" } },
  });
  if (own) throw badRequest("C'est votre propre Riot ID 😄");
  await addTeammate(userId, input).catch((e) => {
    if (!(e instanceof HttpError && e.status === 409)) throw e; // déjà suivi : pas grave
  });
  const target = await prisma.gameIdentity.findFirst({
    where: { gameName: { equals: gameName, mode: "insensitive" }, tagLine: { equals: tagLine, mode: "insensitive" }, userId: { not: userId } },
    select: { userId: true },
  });
  if (!target) return { message: GENERIC };
  const existing = await prisma.friendship.findFirst({
    where: { OR: [{ requesterId: userId, addresseeId: target.userId }, { requesterId: target.userId, addresseeId: userId }] },
  });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
  if (existing) {
    // Il m'avait déjà demandé : on devient amis directement.
    if (existing.status === "PENDING" && existing.requesterId === target.userId) {
      await prisma.friendship.update({ where: { id: existing.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
      await notify(target.userId, { type: "friend_accepted", title: "Nouvel ami 🎉", body: `${me.displayName} a accepté votre demande d'ami.`, link: "/app/friends" });
    } else if (existing.status === "DECLINED" && existing.addresseeId === userId) {
      // J'avais refusé, je change d'avis : nouvelle demande dans l'autre sens.
      await prisma.friendship.delete({ where: { id: existing.id } });
      await prisma.friendship.create({ data: { requesterId: userId, addresseeId: target.userId } });
      await notify(target.userId, { type: "friend_request", title: "Demande d'ami", body: `${me.displayName} veut vous ajouter en ami.`, link: "/app/friends" });
    }
    // Demande déjà envoyée, refusée par l'autre, ou déjà amis : rien de plus (pas de relance).
    return { message: GENERIC };
  }
  await prisma.friendship.create({ data: { requesterId: userId, addresseeId: target.userId } });
  await notify(target.userId, { type: "friend_request", title: "Demande d'ami", body: `${me.displayName} veut vous ajouter en ami.`, link: "/app/friends" });
  return { message: GENERIC };
}

export async function respondFriendRequest(userId: string, id: string, accept: boolean) {
  const f = await prisma.friendship.findUnique({ where: { id }, include: { addressee: { select: { displayName: true } } } });
  if (!f || f.addresseeId !== userId) throw notFound("Demande");
  if (f.status !== "PENDING") throw badRequest("Demande déjà traitée.");
  await prisma.friendship.update({ where: { id }, data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() } });
  if (accept)
    await notify(f.requesterId, { type: "friend_accepted", title: "Nouvel ami 🎉", body: `${f.addressee.displayName} a accepté votre demande d'ami.`, link: "/app/friends" });
}

export async function removeFriend(userId: string, id: string) {
  const f = await prisma.friendship.findUnique({ where: { id } });
  if (!f || (f.requesterId !== userId && f.addresseeId !== userId)) throw notFound("Ami");
  await prisma.friendship.delete({ where: { id } });
}

export async function pendingFriendRequests(userId: string) {
  return prisma.friendship.findMany({
    where: { addresseeId: userId, status: "PENDING" },
    include: { requester: { select: { displayName: true, gameIdentities: { where: { isPrimary: true }, select: { gameName: true, tagLine: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}

async function friendIds(userId: string) {
  const fs = await prisma.friendship.findMany({ where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] } });
  return fs.map((f) => ({ friendshipId: f.id, userId: f.requesterId === userId ? f.addresseeId : f.requesterId, since: f.respondedAt ?? f.createdAt }));
}

/** Résumé d'un joueur : forme, série, badges, rang, stats de la semaine. */
async function playerCard(userId: string) {
  const [user, parts, mvpVotes] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, displayName: true, gameIdentities: { where: { isPrimary: true }, select: { gameName: true, tagLine: true, rank: true } } },
    }),
    prisma.matchParticipant.findMany({
      where: { userId, match: { isDemo: false } },
      include: { statistics: true, scores: { where: { scoreVersionId: CURRENT_SCORE_CONFIG.version } }, match: { select: { gameStartAt: true, createdAt: true, durationSec: true } } },
      orderBy: [{ match: { gameStartAt: "desc" } }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.peerVote.count({ where: { target: { userId }, mvp: true } }),
  ]);
  const games: GameLite[] = parts.map((p) => ({
    win: p.win,
    kills: p.statistics?.kills ?? 0,
    deaths: p.statistics?.deaths ?? 0,
    assists: p.statistics?.assists ?? 0,
    visionScore: p.statistics?.visionScore ?? null,
    creepScore: p.statistics?.creepScore ?? null,
    durationSec: p.match.durationSec,
    score: p.scores[0]?.overall ?? null,
    playedAt: p.match.gameStartAt ?? p.match.createdAt,
  }));
  const weekAgo = Date.now() - 7 * 86400_000;
  const week = games.filter((g) => g.playedAt.getTime() >= weekAgo);
  const weekScores = week.map((g) => g.score).filter((x): x is number => x != null);
  const id = user.gameIdentities[0];
  return {
    userId: user.id,
    displayName: user.displayName,
    riotId: id ? `${id.gameName}#${id.tagLine}` : null,
    rank: (id?.rank ?? null) as { queue: string; tier: string; division: string; lp: number }[] | null,
    form: form(games),
    streak: streak(games),
    badges: badges(games, mvpVotes),
    mvpVotes,
    week: {
      games: week.length,
      wins: week.filter((g) => g.win).length,
      avgScore: weekScores.length ? Math.round((weekScores.reduce((a, b) => a + b, 0) / weekScores.length) * 10) / 10 : null,
    },
  };
}

export async function listFriends(userId: string) {
  const ids = await friendIds(userId);
  const cards = await Promise.all(ids.map(async (f) => ({ ...(await playerCard(f.userId)), friendshipId: f.friendshipId, since: f.since })));
  return cards.sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
}

export type LeaderboardMetric = "score" | "wins" | "mvp";

/** Classement de la semaine entre amis (vous inclus). Note : 3 parties minimum pour être classé. */
export async function friendsLeaderboard(userId: string, metric: LeaderboardMetric = "score") {
  const ids = [userId, ...(await friendIds(userId)).map((f) => f.userId)];
  const cards = await Promise.all(ids.map(playerCard));
  const value = (c: (typeof cards)[number]) =>
    metric === "wins" ? c.week.wins : metric === "mvp" ? c.mvpVotes : c.week.games >= 3 ? c.week.avgScore ?? -1 : -1;
  return cards
    .map((c) => ({ ...c, me: c.userId === userId, value: value(c) }))
    .sort((a, b) => b.value - a.value || b.week.games - a.week.games || a.displayName.localeCompare(b.displayName, "fr"));
}
