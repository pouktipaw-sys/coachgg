"use client";
// Coach conversationnel : questions, réponses sourcées (liens vers matchs et
// clips à l'horodatage), informations manquantes explicites, signalement.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client";

export type CoachMessageDTO = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: { sourceId: string; quote?: string; kind: string; title: string; link: string | null }[] | null;
  missingInformation: string[] | null;
  followUps: string[] | null;
  mode: string | null;
  model: string | null;
  sourcesCount: number | null;
  costMicros: number | null;
  warning: string | null;
  reportedAt: string | null;
  createdAt: string;
};

const KIND_ICON: Record<string, string> = { match: "▤", moment: "▶", goal: "◇", trend: "↗", team_match: "◎", profile: "☺" };
const STARTERS = ["Pourquoi cette note ?", "Quelles erreurs de placement ?", "Quelle meilleure action ?", "Pourquoi cette trajectoire ?", "Que travailler ensuite ?", "Que doit améliorer notre groupe ?"];

export function CoachChat({ threadId, initial, llm }: { threadId: string | null; initial: CoachMessageDTO[]; llm: boolean }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // Identifiant du fil connu immédiatement après sa création (évite d'en créer un 2e
  // si une nouvelle question part avant la fin de la navigation).
  const tid = useRef<string | null>(threadId);
  // Changement de conversation depuis la liste (ou « Nouvelle conversation ») : on recharge.
  useEffect(() => {
    if (threadId !== tid.current) {
      tid.current = threadId;
      setMessages(initial);
      setError(null);
    }
  }, [threadId, initial]);
  useEffect(() => {
    // Ne rien renvoyer : scrollIntoView peut renvoyer une Promise dans certains navigateurs.
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = !tid.current;
      if (!tid.current) tid.current = (await api<{ thread: { id: string } }>("/api/coach/threads", { method: "POST", json: {} })).thread.id;
      const id = tid.current;
      setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content: text, citations: null, missingInformation: null, followUps: null, mode: null, model: null, sourcesCount: null, costMicros: null, warning: null, reportedAt: null, createdAt: new Date().toISOString() }]);
      setInput("");
      const r = await api<{ message: CoachMessageDTO }>(`/api/coach/threads/${id}/messages`, { method: "POST", json: { content: text } });
      setMessages((m) => [...m, r.message]);
      if (created) router.replace(`/app/coach?thread=${id}`, { scroll: false });
      else router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const last = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-4" aria-live="polite" data-testid="coach-messages">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-line p-6 text-sm">
            <p className="font-medium">Posez une question sur vos parties.</p>
            <p className="mt-1 text-muted">
              Le coach répond uniquement à partir de vos données autorisées (matchs, moments vidéo validés, objectifs, groupes) et cite ses sources.
              {llm ? "" : " Mode sans IA : réponses par règles aux questions ci-dessous."}
            </p>
          </div>
        )}
        {messages.map((m) => (m.role === "user" ? (
          <div key={m.id} className="ml-auto max-w-[85%] rounded-xl bg-accent/20 px-4 py-2 text-sm">{m.content}</div>
        ) : (
          <AssistantMessage key={m.id} m={m} />
        )))}
        {busy && <p className="text-sm text-muted anim-pulse">Le coach consulte vos données…</p>}
        <div ref={end} />
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          {(last?.followUps?.length ? last.followUps : STARTERS).slice(0, 6).map((s) => (
            <button key={s} className="rounded-full border border-line px-3 py-1 text-xs hover:border-accent/60" onClick={() => send(s)} disabled={busy}>{s}</button>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-loss">{error}</p>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ex. Pourquoi ma note a baissé ?" maxLength={1000} aria-label="Question au coach" data-testid="coach-input" />
          <button className="btn-primary" disabled={busy || input.trim().length < 2}>Envoyer</button>
        </form>
      </div>
    </div>
  );
}

function AssistantMessage({ m }: { m: CoachMessageDTO }) {
  const [reported, setReported] = useState(!!m.reportedAt);
  return (
    <article className="max-w-[92%] rounded-xl border border-line bg-panel px-4 py-3 text-sm" data-testid="coach-answer">
      <p className="whitespace-pre-line">{m.content}</p>
      {m.citations && m.citations.length > 0 && (
        <div className="mt-3">
          <p className="label">Sources</p>
          <ul className="flex flex-wrap gap-2" data-testid="coach-citations">
            {m.citations.map((c) => (
              <li key={c.sourceId}>
                {c.link ? (
                  <Link href={c.link} className="inline-flex items-center gap-1 rounded-md border border-line bg-panel-2 px-2 py-1 text-xs hover:border-accent/60" title={c.quote}>
                    <span aria-hidden>{KIND_ICON[c.kind] ?? "•"}</span> {c.title}
                  </Link>
                ) : (
                  <span className="rounded-md border border-line px-2 py-1 text-xs">{c.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.missingInformation && m.missingInformation.length > 0 && (
        <div className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-2 text-xs" data-testid="coach-missing">
          <p className="font-medium text-warn">Information manquante</p>
          <ul className="list-disc pl-4 text-muted">{m.missingInformation.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {m.warning && <p className="mt-2 text-xs text-warn">{m.warning}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span data-testid="coach-mode">
          {m.mode === "llm" ? `IA (${m.model})` : m.mode === "llm_fallback_rules" ? "Mode sans IA (repli)" : "Mode sans IA (règles)"}
        </span>
        {m.sourcesCount != null && <span>{m.sourcesCount} source(s) autorisée(s) consultée(s)</span>}
        {m.costMicros != null && <span>coût ≈ {(m.costMicros / 1e6).toFixed(4)} $</span>}
        {reported ? (
          <span className="text-warn">Signalé</span>
        ) : (
          <button
            className="underline hover:text-text"
            onClick={async () => {
              const c = prompt("Qu'est-ce qui est faux ? Proposez une correction (facultatif).") ?? undefined;
              if (c === undefined) return;
              await api(`/api/coach/messages/${m.id}/report`, { method: "POST", json: { comment: c || undefined } });
              setReported(true);
            }}
          >
            Signaler une erreur
          </button>
        )}
      </div>
    </article>
  );
}
