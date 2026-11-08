"use client";
// Bouton qui appelle réellement l'API puis rafraîchit la page (pas de bouton factice).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";

export function ActionButton({
  url,
  method = "POST",
  body,
  label,
  done,
  confirmText,
  className = "btn-ghost",
  redirectTo,
}: {
  url: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  label: string;
  done?: string;
  confirmText?: string;
  className?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirmText && !confirm(confirmText)) return;
          setBusy(true);
          setMsg(null);
          try {
            await api(url, { method, json: body ?? {} });
            if (done) setMsg(done);
            if (redirectTo) router.push(redirectTo);
            router.refresh();
          } catch (e) {
            setMsg(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "…" : label}
      </button>
      {msg && <span role="status" className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
