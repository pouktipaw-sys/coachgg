"use client";
// État de la synchronisation de l'historique Riot (suivi en direct, relance).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client";

type Job = { status: string; progress: number; error: string | null; result: { imported?: number; linked?: number; scanned?: number } | null } | null;

export function RiotSyncStatus({ initial, riotId }: { initial: Job; riotId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<Job>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const active = job?.status === "PENDING" || job?.status === "RUNNING";

  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ job: Job }>("/api/riot/sync");
        if (stop) return;
        setJob(r.job);
        router.refresh(); // les parties apparaissent au fur et à mesure
        if (r.job && !["PENDING", "RUNNING"].includes(r.job.status)) return;
      } catch {}
      if (!stop) setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 2000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [active, router]);

  async function resync() {
    setMsg(null);
    try {
      await api("/api/riot/sync", { method: "POST" });
      setJob((j) => ({ ...(j ?? { error: null, result: null }), status: "PENDING", progress: 0 }));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }

  const added = (job?.result?.imported ?? 0) + (job?.result?.linked ?? 0);
  return (
    <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="riot-sync">
      <div>
        <p>
          Historique Riot de <strong>{riotId}</strong> :{" "}
          {active ? (
            <span className="text-accent-2">synchronisation en cours… {job!.progress} %</span>
          ) : job?.status === "FAILED" ? (
            <span className="text-loss">échec — {job.error}</span>
          ) : job ? (
            <span className="text-win">à jour{added ? ` (${added} partie(s) ajoutée(s) lors de la dernière synchronisation)` : ""}</span>
          ) : (
            <span className="text-muted">pas encore synchronisé</span>
          )}
        </p>
        <p className="text-xs text-muted">Toutes vos parties sont importées automatiquement, puis mises à jour à chaque visite (au plus toutes les 15 min).</p>
        {msg && <p className="text-xs text-loss">{msg}</p>}
      </div>
      {!active && <button className="btn-ghost text-xs" onClick={resync}>Tout resynchroniser</button>}
    </div>
  );
}
