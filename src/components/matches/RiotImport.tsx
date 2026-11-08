"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";

export function RiotImport() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ results: { status: string }[] }>("/api/matches/import", { method: "POST", json: { count: 10 } });
      const n = r.results.filter((x) => x.status !== "already").length;
      setMsg(`${n} match(s) importé(s) ou relié(s), ${r.results.length - n} déjà présent(s).`);
      router.refresh();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <button className="btn-primary" onClick={run} disabled={busy}>{busy ? "Import en cours…" : "Importer mes 10 dernières parties"}</button>
      {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
    </div>
  );
}
