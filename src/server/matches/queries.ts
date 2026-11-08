import { prisma } from "../db";

/** Matchs auxquels l'utilisateur a participé ou qu'il a créés (pour les sélecteurs). */
export async function userMatchOptions(userId: string) {
  const matches = await prisma.match.findMany({
    where: { OR: [{ createdById: userId }, { participants: { some: { userId } } }] },
    orderBy: [{ gameStartAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: { participants: { where: { userId }, select: { championName: true, win: true } } },
  });
  return matches.map((m) => {
    const me = m.participants[0];
    const date = (m.gameStartAt ?? m.createdAt).toLocaleDateString("fr-FR");
    return {
      id: m.id,
      label: `${date} · ${me?.championName ?? "?"} · ${me ? (me.win ? "Victoire" : "Défaite") : ""} · ${Math.round(m.durationSec / 60)} min`,
    };
  });
}
