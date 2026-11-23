import { EmptyState, PageHeader } from "@/components/ui";
import { ChampionGrid } from "@/components/explore/ChampionGrid";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { ddChampions, ddVersion, normChamp } from "@/server/riot/ddragon";

export const metadata = { title: "Champions" };

export default async function ChampionsPage() {
  const user = await requirePageUser();
  const [v, champs, mine] = await Promise.all([
    ddVersion().catch(() => null),
    ddChampions().catch(() => null),
    prisma.matchParticipant.groupBy({ by: ["championName"], where: { userId: user.id, match: { isDemo: false } }, _count: { _all: true } }),
  ]);
  const count = new Map(mine.map((m) => [normChamp(m.championName), m._count._all]));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Explorer" title="Champions" subtitle="Sorts, conseils et tes propres statistiques sur chaque champion (données officielles de Riot, en français)." />
      {!v || !champs ? (
        <EmptyState icon="rank" title="Données du jeu indisponibles" text="Impossible de joindre le serveur de données de Riot pour l'instant. Réessaie dans un moment." />
      ) : (
        <ChampionGrid
          version={v}
          champions={champs.map((c) => ({ id: c.id, name: c.name, title: c.title, tags: c.tags, image: c.image.full, mine: count.get(normChamp(c.id)) ?? count.get(normChamp(c.name)) ?? 0 }))}
        />
      )}
    </div>
  );
}
