// Notifications de nouveau patch : quand la version du jeu change, chaque joueur reçoit les changements chiffrés
// de SES champions (préférés + les plus joués sur 60 jours), mesurés sur les données officielles des deux versions.
// Première exécution : la version est seulement mémorisée (pas de notification).
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { notify } from "./notifications";
import { ddChampionDetail, ddChampions, ddVersion, findChampion } from "./riot/ddragon";
import { championChanges } from "@/lib/riot/patchDiff";

const KEY = "ddragon.version";
const patchLabel = (v: string) => v.split(".").slice(0, 2).join(".");

/** Champions suivis par chaque joueur : préférés (profil) et 3 plus joués des 60 derniers jours. */
async function followedChampions() {
  const since = new Date(Date.now() - 60 * 86_400_000);
  const [profiles, played] = await Promise.all([
    prisma.playerProfile.findMany({ where: { favoriteChampions: { isEmpty: false } }, select: { userId: true, favoriteChampions: true } }),
    prisma.matchParticipant.groupBy({ by: ["userId", "championName"], where: { userId: { not: null }, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const map = new Map<string, Set<string>>();
  for (const p of profiles) map.set(p.userId, new Set(p.favoriteChampions));
  const byUser = new Map<string, { name: string; n: number }[]>();
  for (const r of played) byUser.set(r.userId!, [...(byUser.get(r.userId!) ?? []), { name: r.championName, n: r._count._all }]);
  for (const [u, list] of byUser) {
    const set = map.get(u) ?? new Set<string>();
    list.sort((a, b) => b.n - a.n).slice(0, 3).forEach((x) => set.add(x.name));
    map.set(u, set);
  }
  return map;
}

export async function checkNewPatch() {
  const current = await ddVersion();
  const state = await prisma.appState.findUnique({ where: { key: KEY } });
  const previous = (state?.value as { version?: string } | null)?.version ?? null;
  if (previous === current) return { changed: false, version: current, notified: 0 };
  await prisma.appState.upsert({ where: { key: KEY }, update: { value: { version: current } as Prisma.InputJsonValue }, create: { key: KEY, value: { version: current } as Prisma.InputJsonValue } });
  if (!previous || patchLabel(previous) === patchLabel(current)) return { changed: !!previous, version: current, notified: 0 }; // 1re fois, ou simple correctif
  const [champs, followed] = await Promise.all([ddChampions(), followedChampions()]);
  const changes = new Map<string, { name: string; lines: string[] }>();
  const ids = new Set([...followed.values()].flatMap((s) => [...s]).map((n) => findChampion(champs, n)?.id).filter((x): x is string => !!x));
  for (const id of ids) {
    const [a, b] = await Promise.all([ddChampionDetail(id, previous).catch(() => null), ddChampionDetail(id, current).catch(() => null)]);
    if (a && b) changes.set(id, { name: b.name, lines: championChanges(a, b) });
  }
  let notified = 0;
  for (const [userId, names] of followed) {
    const mine = [...names].map((n) => findChampion(champs, n)?.id).filter((id): id is string => !!id && changes.has(id));
    if (!mine.length) continue;
    const changed = mine.filter((id) => changes.get(id)!.lines.length);
    const body = changed.length
      ? changed.slice(0, 4).map((id) => `${changes.get(id)!.name} : ${changes.get(id)!.lines.slice(0, 3).join(" ; ")}${changes.get(id)!.lines.length > 3 ? "…" : ""}`).join("\n")
      : `Aucun changement chiffré (statistiques, récupérations, coûts, portées) pour ${mine.map((id) => changes.get(id)!.name).join(", ")}.`;
    await notify(userId, {
      type: "patch",
      title: `Patch ${patchLabel(current)} : ${changed.length ? `${changed.length} de tes champions changent` : "rien ne change pour tes champions"}`,
      body: body.slice(0, 900),
      link: changed[0] ? `/app/champions/${changed[0]}` : "/app/champions",
    });
    notified++;
  }
  return { changed: true, version: current, notified };
}
