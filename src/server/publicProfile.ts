// Profil public partageable : désactivé par défaut, activé explicitement par le joueur.
// Contenu limité : pseudo, Riot ID principal, rang, statistiques globales, champions, dernières parties.
// Jamais : vidéos, moments de coaching, amis, groupes, email.
import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { userGames } from "./riot/explorer";
import { byChampion, summarize } from "@/lib/riot/insights";

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "joueur";

export async function setPublicProfile(userId: string, enabled: boolean) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
  const cur = await prisma.playerProfile.upsert({ where: { userId }, update: {}, create: { userId } });
  const publicSlug = cur.publicSlug ?? `${slugify(user.displayName)}-${randomBytes(2).toString("hex")}`;
  const p = await prisma.playerProfile.update({ where: { userId }, data: { publicProfile: enabled, publicSlug } });
  return { enabled: p.publicProfile, slug: p.publicSlug };
}

/** null si le profil n'existe pas ou n'est pas public (aucune différence visible entre les deux cas). */
export async function publicProfile(slug: string) {
  const p = await prisma.playerProfile.findUnique({ where: { publicSlug: slug }, include: { user: { select: { id: true, displayName: true, createdAt: true } } } });
  if (!p?.publicProfile) return null;
  const [identity, games] = await Promise.all([
    prisma.gameIdentity.findFirst({ where: { userId: p.userId, isPrimary: true }, select: { gameName: true, tagLine: true, platform: true, rank: true } }),
    userGames([p.userId]),
  ]);
  const recent = games.slice(0, 50);
  return {
    displayName: p.user.displayName,
    memberSince: p.user.createdAt,
    role: p.primaryRole,
    favoriteChampions: p.favoriteChampions,
    riotId: identity ? `${identity.gameName}#${identity.tagLine}` : null,
    platform: identity?.platform ?? null,
    ranks: (Array.isArray(identity?.rank) ? identity!.rank : []) as { queue: string; label: string; tier: string; division: string; lp: number; wins: number; losses: number }[],
    summary: summarize(recent),
    champions: byChampion(recent).slice(0, 5),
    games: recent.slice(0, 10).map((g) => ({ win: g.win, championName: g.championName, kills: g.kills, deaths: g.deaths, assists: g.assists, cs: g.cs, durationSec: g.durationSec, date: g.date })),
  };
}
