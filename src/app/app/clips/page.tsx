import { ClipCard, type ClipDTO } from "@/components/clips/ClipCard";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { listClips } from "@/server/clips";
import { KIND_LABELS, MOMENT_KINDS } from "@/lib/annotations/schema";

export const metadata = { title: "Clips" };
export const dynamic = "force-dynamic";

export default async function ClipsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const clips = JSON.parse(JSON.stringify(await listClips(user.id, sp))) as ClipDTO[];
  const filtered = Object.values(sp).some(Boolean);
  return (
    <div>
      <PageHeader title="Clips" subtitle="Vos séquences : favoris, notes personnelles, bonnes actions et décisions à revoir. Exportables avec leurs annotations." />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Titre ou note…" className="input max-w-xs" aria-label="Rechercher" />
        <select name="kind" defaultValue={sp.kind ?? ""} className="input max-w-[220px]" aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {MOMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="favorite" value="1" defaultChecked={sp.favorite === "1"} /> Favoris
        </label>
        <button className="btn-ghost">Filtrer</button>
      </form>
      {clips.length === 0 ? (
        <EmptyState
          title={filtered ? "Aucun clip ne correspond" : "Aucun clip"}
          text={filtered ? undefined : "Dans le lecteur, utilisez « Créer un clip » ou « Ajouter à mes clips » sur un moment de coaching."}
          action={filtered ? { href: "/app/clips", label: "Réinitialiser" } : { href: "/app/videos", label: "Ouvrir mes vidéos" }}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{clips.map((c) => <ClipCard key={c.id} clip={c} me={user.id} />)}</ul>
      )}
      <p className="mt-4 text-xs text-muted">
        L&apos;export incruste les corrections dans la vidéo (ralenti, pause à la décision, alternative, explication). Les propositions automatiques non validées ne sont jamais incrustées.
      </p>
    </div>
  );
}
