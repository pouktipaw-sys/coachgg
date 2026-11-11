"use client";
// État de la synchronisation de l'historique de chaque compte Riot (suivi en direct, relance).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client";

type Job = { status: string; progress: number; error: string | null; result: unknown } | null;
export type SyncAccount = { identityId: string; riotId: string; primary: boolean; job: Job };

const added = (j: Job) => {
  const r = (j?.result ?? null) as { imported?: number; linked?: number } | null;
  return (r?.imported ?? 0) + (r?.linked ?? 0);
};

export function RiotSyncStatus({ initial }: { initial: SyncAccount[] }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const active = accounts.some((a) => a.job?.status === "PENDING" || a.job?.status === "RUNNING");

  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ accounts: SyncAccount[] }>("/api/riot/sync");
        if (stop) return;
        setAccounts(r.accounts);
        router.refresh(); // les parties apparaissent au fur et à mesure
        if (!r.accounts.some((a) => a.job?.status === "PENDING" || a.job?.status === "RUNNING")) return;
      } catch {}
      if (!stop) setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 2000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [active, router]);

  async function resync(identityId?: string) {
    setMsg(null);
    try {
      await api("/api/riot/sync", { method: "POST", json: identityId ? { identityId } : {} });
      setAccounts((as) => as.map((a) => (!identityId || a.identityId === identityId ? { ...a, job: { status: "PENDING", progress: 0, error: null, result: null } } : a)));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  if (!accounts.length) return null;
  return (
    <div className="card mb-4 space-y-2 text-sm" data-testid="riot-sync">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Historique Riot {accounts.length > 1 ? `· ${accounts.length} comptes` : ""}</p>
        {!active && <button className="btn-ghost text-xs" onClick={() => resync()}>Tout resynchroniser</button>}
      </div>
      <ul className="space-y-1">
        {accounts.map((a) => {
          const j = a.job;
          const running = j?.status === "PENDING" || j?.status === "RUNNING";
          return (
            <li key={a.identityId} className="flex flex-wrap items-center gap-2">
              <strong>{a.riotId}</strong>
              {a.primary && <span className="badge text-xs">principal</span>}
              <span className="text-xs">
                {running ? (
                  <span className="text-accent-2">synchronisation… {j!.progress} %</span>
                ) : j?.status === "FAILED" ? (
                  <span className="text-loss">échec — {j.error}</span>
                ) : j ? (
                  <span className="text-win">à jour{added(j) ? ` (+${added(j)} partie(s))` : ""}</span>
                ) : (
                  <span className="text-muted">pas encore synchronisé</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">Toutes les parties de chaque compte sont importées automatiquement, puis mises à jour à chaque visite (au plus toutes les 15 min).</p>
      {msg && <p className="text-xs text-loss">{msg}</p>}
    </div>
  );
}
