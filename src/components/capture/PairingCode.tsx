"use client";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client";

export function PairingCode() {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [left, setLeft] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.round((new Date(code.expiresAt).getTime() - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [code]);

  return (
    <div className="space-y-2">
      <button
        className="btn-primary"
        data-testid="pairing-generate"
        onClick={async () => {
          setMsg(null);
          try {
            setCode(await api<{ code: string; expiresAt: string }>("/api/devices/pairing-codes", { method: "POST", json: {} }));
          } catch (e) {
            setMsg(errorMessage(e));
          }
        }}
      >
        Générer un code d&apos;appairage
      </button>
      {code && left > 0 && (
        <p className="text-sm">
          Code : <span className="rounded bg-panel-2 px-2 py-1 font-mono text-lg tracking-widest" data-testid="pairing-code">{code.code}</span>{" "}
          <span className="text-xs text-muted">valable encore {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}, utilisable une seule fois</span>
        </p>
      )}
      {code && left === 0 && <p className="text-xs text-muted">Code expiré : générez-en un nouveau.</p>}
      {msg && <p role="alert" className="text-sm text-loss">{msg}</p>}
    </div>
  );
}
