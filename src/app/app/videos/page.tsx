import Link from "next/link";
import { Badge, EmptyState, PageHeader, RECORDING_STATUS, formatBytes, formatDate } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { visibleRecordingWhere } from "@/server/permissions";
import { formatMs } from "@/lib/annotations/coaching";

export const metadata = { title: "Vidéos" };

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const user = await requirePageUser();
  const { q, filter } = await searchParams;
  const recordings = await prisma.recording.findMany({
    where: {
      AND: [
        filter === "shared" ? { ownerId: { not: user.id }, ...visibleRecordingWhere(user.id) } : filter === "mine" ? { ownerId: user.id } : visibleRecordingWhere(user.id),
        q ? { title: { contains: q, mode: "insensitive" } } : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      owner: { select: { displayName: true } },
      match: { select: { id: true } },
      _count: { select: { recommendations: true, annotations: true } },
    },
  });
  const used = await prisma.recording.aggregate({ where: { ownerId: user.id }, _sum: { sizeBytes: true } });

  return (
    <div>
      <PageHeader
        title="Vidéos & coaching"
        subtitle={`Espace utilisé : ${formatBytes(Number(used._sum.sizeBytes ?? 0))}`}
        actions={<Link href="/app/videos/upload" className="btn-primary">Importer une vidéo</Link>}
      />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Rechercher un titre…" className="input max-w-xs" aria-label="Rechercher" />
        <select name="filter" defaultValue={filter ?? ""} className="input max-w-[200px]" aria-label="Filtre">
          <option value="">Toutes</option>
          <option value="mine">Mes vidéos</option>
          <option value="shared">Partagées avec moi</option>
        </select>
        <button className="btn-ghost">Filtrer</button>
      </form>

      {recordings.length === 0 ? (
        <EmptyState
          title="Aucune vidéo pour l'instant"
          text="Importez l'enregistrement d'une partie pour créer vos premiers moments de coaching annotés."
          action={{ href: "/app/videos/upload", label: "Importer une vidéo" }}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {recordings.map((r) => {
            const st = RECORDING_STATUS[r.status]!;
            const mine = r.ownerId === user.id;
            return (
              <li key={r.id} className="card flex flex-col gap-3 p-0">
                <Link href={r.status === "UPLOADING" && mine ? `/app/videos/upload?resume=${r.id}` : `/app/videos/${r.id}`} className="block">
                  <div className="relative aspect-video overflow-hidden rounded-t-xl bg-panel-2">
                    {r.thumbnailKey ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/recordings/${r.id}/thumbnail`} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted">{st.label}</div>
                    )}
                    {r.durationMs != null && (
                      <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 text-xs">{formatMs(r.durationMs)}</span>
                    )}
                  </div>
                </Link>
                <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/app/videos/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {formatDate(r.createdAt)} · {mine ? "Ma vidéo" : `Partagée par ${r.owner.displayName}`}
                    {r.match ? " · liée à un match" : ""}
                  </p>
                  <p className="text-xs text-muted">
                    {r._count.recommendations} moment(s) · {r._count.annotations} annotation(s)
                  </p>
                  {r.status === "UPLOADING" && mine && (
                    <p className="text-xs text-warn">
                      Envoi interrompu à {Math.floor((Number(r.receivedBytes) / Number(r.sizeBytes)) * 100)} % —{" "}
                      <Link className="underline" href={`/app/videos/upload?resume=${r.id}`}>reprendre</Link>
                    </p>
                  )}
                  {r.status === "FAILED" && <p className="text-xs text-loss">{r.errorMessage}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
