"use client";
// Après la partie : chaque joueur note ses coéquipiers (/10), vote pour le MVP et attribue des catégories.
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";
import { AWARDS, AWARD_LABEL, type AwardKey, type Tally } from "@/lib/votes";
import { ROLE_LABELS } from "@/components/stats";

export type VoteBoard = {
  me: { id: string; side: number } | null;
  mates: { id: string; name: string; championName: string; role: string | null; hasAccount: boolean }[];
  names: Record<string, string>;
  myBallot: { targetId: string; score: number; mvp: boolean; awards: string[] }[];
  results: { side: number; tally: Tally }[];
};

type Row = { score: number | null; mvp: boolean; awards: string[] };

export function PeerVotePanel({ matchId, initial }: { matchId: string; initial: VoteBoard }) {
  const [board, setBoard] = useState(initial);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(initial.mates.map((m) => {
      const b = initial.myBallot.find((x) => x.targetId === m.id);
      return [m.id, { score: b?.score ?? null, mvp: b?.mvp ?? false, awards: b?.awards ?? [] }];
    })),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));
  const setMvp = (id: string) => setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, mvp: k === id }])));
  // Une catégorie ne va qu'à un seul joueur : la donner à l'un la retire aux autres.
  const toggleAward = (id: string, a: AwardKey) =>
    setRows((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, { ...v, awards: k === id ? (v.awards.includes(a) ? v.awards.filter((x) => x !== a) : [...v.awards, a]) : v.awards.filter((x) => x !== a) }]),
      ),
    );

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const votes = Object.entries(rows)
        .filter(([, v]) => v.score != null)
        .map(([targetId, v]) => ({ targetId, score: v.score!, mvp: v.mvp, awards: v.awards }));
      if (Object.values(rows).some((v) => v.score == null && (v.mvp || v.awards.length))) throw new Error("Donnez une note aux joueurs choisis comme MVP ou récompensés.");
      setBoard(await api<VoteBoard>(`/api/matches/${matchId}/votes`, { method: "PUT", json: { votes } }));
      setMsg("Vote enregistré.");
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="votes" className="card space-y-4" data-testid="peer-votes">
      <div>
        <h2 className="h2">Notes de l&apos;équipe et élection du MVP</h2>
        <p className="mt-1 text-xs text-muted">
          Chaque joueur de la partie note ses coéquipiers. Le MVP élu est celui qui reçoit le plus de votes (à égalité : la meilleure note moyenne).
          C&apos;est un avis des joueurs, distinct de la note CoachGG calculée sur les statistiques.
        </p>
      </div>

      {board.results.map(({ side, tally }) => (
        <div key={side} className="rounded-lg bg-panel-2 p-3 text-sm" data-testid={`vote-results-${side}`}>
          <p className="text-xs uppercase tracking-wide text-muted">Équipe {side === 100 ? "bleue" : "rouge"} · {tally.voters} votant(s)</p>
          {tally.mvp == null ? (
            <p className="mt-1 text-muted">Pas encore de MVP élu.</p>
          ) : "targetId" in tally.mvp ? (
            <p className="mt-1">🏆 MVP élu : <strong data-testid="elected-mvp">{board.names[tally.mvp.targetId]}</strong> ({tally.mvp.votes} vote(s))</p>
          ) : (
            <p className="mt-1">Égalité pour le MVP : {tally.mvp.tie.map((id) => board.names[id]).join(", ")}</p>
          )}
          {Object.entries(tally.awards).length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-2 text-xs">
              {Object.entries(tally.awards).map(([k, id]) => (
                <li key={k} className="badge">{AWARD_LABEL[k as AwardKey]} : {id ? board.names[id] : "égalité"}</li>
              ))}
            </ul>
          )}
          {Object.keys(tally.perTarget).length > 0 && (
            <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
              {Object.entries(tally.perTarget).map(([id, t]) => (
                <li key={id}>{board.names[id]} : <span className="font-mono">{t.avgScore}/10</span> ({t.voters} note(s){t.mvpVotes ? `, ${t.mvpVotes} vote(s) MVP` : ""})</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {!board.me ? (
        <p className="text-sm text-muted">Seuls les joueurs de la partie peuvent voter.</p>
      ) : board.mates.length === 0 ? (
        <p className="text-sm text-muted">Aucun coéquipier renseigné pour cette partie.</p>
      ) : (
        <div className="space-y-3">
          <h3 className="font-medium">Mon vote</h3>
          {board.mates.map((m) => {
            const r = rows[m.id]!;
            return (
              <div key={m.id} className="rounded-lg border border-line p-3" data-testid="vote-row">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-40 font-medium">
                    {m.name} <span className="text-xs text-muted">· {m.championName}{m.role ? ` · ${ROLE_LABELS[m.role] ?? m.role}` : ""}</span>
                  </span>
                  <label className="flex items-center gap-1 text-sm">
                    Note
                    <select className="input w-20 py-1" value={r.score ?? ""} onChange={(e) => set(m.id, { score: e.target.value ? Number(e.target.value) : null })} aria-label={`Note de ${m.name}`}>
                      <option value="">—</option>
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    /10
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <input type="radio" name="mvp" checked={r.mvp} onChange={() => setMvp(m.id)} aria-label={`MVP : ${m.name}`} /> 🏆 MVP
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {AWARDS.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => toggleAward(m.id, a.key)}
                      aria-pressed={r.awards.includes(a.key)}
                      className={`rounded-full border px-2 py-0.5 text-xs ${r.awards.includes(a.key) ? "border-accent bg-accent/20" : "border-line text-muted hover:text-text"}`}
                    >
                      {a.icon} {a.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={save} disabled={busy} data-testid="vote-save">{busy ? "…" : "Enregistrer mon vote"}</button>
            {msg && <span role="status" className="text-sm text-muted">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
