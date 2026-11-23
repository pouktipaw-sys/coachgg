import { EmptyState } from "@/components/ui";

/** Aucune statistique méta collectée : explique comment activer la collecte (rien n'est inventé). */
export function MetaEmpty() {
  return (
    <EmptyState
      icon="stats"
      title="Pas encore de statistiques méta"
      text={
        <>
          Les statistiques globales viennent de parties classées publiques collectées en tâche de fond. Pour l&apos;activer, ajoute
          dans <code>.env</code> : <code>META_CRAWL_PLATFORMS=&quot;EUW1&quot;</code> puis relance <code>npm run dev:all</code>. Avec une clé
          de développement Riot, la collecte est lente (quelques centaines de parties par heure) ; une clé « Production » la rend rapide.
        </>
      }
    />
  );
}
