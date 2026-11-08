// Client HTTP du serveur CoachGG pour l'agent (jeton d'appareil).
import { open } from "node:fs/promises";
import type { LiveEvent } from "./liveclient";

export class ServerError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
  /** Erreur définitive (inutile de réessayer). */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 409 && this.status !== 429;
  }
}

type Fetch = typeof fetch;

export class CoachApi {
  constructor(private base: string, private token: string | null, private fetcher: Fetch = fetch) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(new URL(path, this.base), {
        ...init,
        headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new ServerError(0, "network", `Serveur injoignable : ${e instanceof Error ? e.message : e}`);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ServerError(res.status, data?.error ?? "error", data?.message ?? `Erreur ${res.status}`, data?.details);
    return data as T;
  }

  pair(code: string, name: string, platform: string, appVersion: string) {
    return this.call<{ token: string; device: { id: string; name: string } }>("/api/devices/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, platform, appVersion }),
    });
  }

  me() {
    return this.call<{ device: { id: string; name: string } }>("/api/devices/me");
  }

  heartbeat(status: Record<string, unknown>) {
    return this.call("/api/devices/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(status) });
  }

  createRecording(body: { filename: string; sizeBytes: number; mimeType: string; title: string; gameStartOffsetMs?: number; capturedAt?: string; clientUploadId: string }) {
    return this.call<{ id: string; chunkSize: number; receivedBytes: number; status: string }>("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  uploadState(id: string) {
    return this.call<{ status: string; receivedBytes: number; sizeBytes: number; chunkSize: number }>(`/api/recordings/${id}/upload`);
  }

  async putChunk(id: string, file: string, offset: number, length: number) {
    const fh = await open(file, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return this.call<{ receivedBytes: number; complete: boolean }>(`/api/recordings/${id}/upload`, {
        method: "PUT",
        headers: { "Upload-Offset": String(offset), "Content-Type": "application/octet-stream" },
        body: buf.subarray(0, bytesRead),
      });
    } finally {
      await fh.close();
    }
  }

  liveEvents(id: string, activePlayer: string, events: LiveEvent[]) {
    return this.call<{ deaths: number }>(`/api/recordings/${id}/live-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activePlayer, events: events.slice(0, 2000) }),
    });
  }
}
