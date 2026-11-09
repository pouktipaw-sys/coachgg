import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { CoachChat, type CoachMessageDTO } from "@/components/coach/CoachChat";
import { IntegrationNotice, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/page";
import { getThread, listThreads } from "@/server/coach/service";
import { llmConfigured, COACH_MODEL } from "@/server/coach/llm";
import { HttpError } from "@/server/errors";

export const metadata = { title: "Coach" };
export const dynamic = "force-dynamic";

const toPlain = <T,>(x: unknown) => JSON.parse(JSON.stringify(x)) as T;

export default async function CoachPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const user = await requirePageUser();
  const { thread: threadId } = await searchParams;
  const threads = await listThreads(user.id);
  let messages: CoachMessageDTO[] = [];
  let current: string | null = null;
  if (threadId) {
    try {
      const t = await getThread(user.id, threadId);
      messages = toPlain<CoachMessageDTO[]>(t.messages);
      current = t.thread.id;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
    }
  }
  const llm = llmConfigured();
  return (
    <div>
      <PageHeader
        title="Coach"
        subtitle="Questions sur vos parties, réponses citant vos matchs, clips et objectifs."
        actions={<Link href="/app/coach" className="btn-ghost">Nouvelle conversation</Link>}
      />
      {!llm && (
        <div className="mb-4">
          <IntegrationNotice title="Mode IA non configuré — mode sans IA actif">
            Sans clé API Anthropic côté serveur (<code>ANTHROPIC_API_KEY</code>), le coach répond par des règles fixes aux questions courantes,
            toujours à partir de vos données et avec leurs sources. Avec la clé, les réponses sont rédigées par Claude ({COACH_MODEL}), sous les mêmes
            contraintes (données autorisées uniquement, citations vérifiées, information manquante signalée).
          </IntegrationNotice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-1 text-sm" aria-label="Conversations">
          {threads.length === 0 ? (
            <p className="text-muted">Aucune conversation.</p>
          ) : (
            threads.map((t) => (
              <div key={t.id} className={`flex items-center gap-1 rounded-lg px-2 py-1.5 ${t.id === current ? "bg-accent/15" : "hover:bg-panel-2"}`}>
                <Link href={`/app/coach?thread=${t.id}`} className="flex-1 truncate">{t.title}</Link>
                {t.id === current && (
                  <ActionButton url={`/api/coach/threads/${t.id}`} method="DELETE" label="✕" className="text-xs text-muted" confirmText="Supprimer cette conversation ?" redirectTo="/app/coach" />
                )}
              </div>
            ))
          )}
        </aside>
        <section className="card">
          <CoachChat threadId={current} initial={messages} llm={llm} />
        </section>
      </div>
      <p className="mt-4 text-xs text-muted">
        Le coach n&apos;utilise que ce que vous pouvez déjà voir : vos matchs, les moments validés de vos vidéos et de celles partagées avec vous, vos objectifs,
        et les rapports de vos groupes. Il ne connaît pas vos communications vocales et ne garantit aucun résultat.
      </p>
    </div>
  );
}
