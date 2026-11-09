import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui";
import { SyncViewer } from "@/components/video/SyncViewer";
import { requirePageUser } from "@/server/auth/page";
import { HttpError } from "@/server/errors";
import { syncSession } from "@/server/video/sync";

export const metadata = { title: "Visionnage synchronisé" };

export default async function SyncPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  let session;
  try {
    session = await syncSession(user.id, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Visionnage synchronisé"
        subtitle="Les vidéos de cette partie avancent ensemble sur le même temps de jeu. Seules les vidéos que vous pouvez déjà voir apparaissent."
        actions={<Link className="btn" href={`/app/matches/${id}`}>← Rapport de match</Link>}
      />
      {session.tracks.length === 0 ? (
        <EmptyState
          title="Aucune vidéo synchronisée"
          text="Pour lire des vidéos côte à côte, chacune doit être prête et être synchronisée avec l’horloge du jeu (onglet « Synchro » de son lecteur)."
        />
      ) : (
        <SyncViewer tracks={session.tracks} />
      )}
      {session.unsynced.length > 0 && (
        <section className="card text-sm">
          <h2 className="h2">Vidéos non synchronisées</h2>
          <p className="mt-1 text-muted">Ouvrez la vidéo, onglet « Synchro », et saisissez l’horloge du jeu pour l’ajouter ici.</p>
          <ul className="mt-2 list-disc pl-5">
            {session.unsynced.map((r) => (
              <li key={r.id}>
                <Link className="underline" href={`/app/videos/${r.id}`}>{r.title}</Link>
                {!r.mine && <span className="text-xs text-muted"> · partagée par {r.ownerName}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
