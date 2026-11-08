// File d'envoi persistante (queue.json) : survit aux redémarrages, reprend un
// envoi interrompu à l'octet près, idempotente côté serveur (clientUploadId).
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CoachApi } from "./api";
import { ServerError } from "./api";
import type { LiveEvent } from "./liveclient";

export type QueueItem = {
  id: string; // clientUploadId
  file: string;
  title: string;
  sizeBytes: number;
  capturedAt: string;
  gameStartOffsetMs?: number;
  activePlayer?: string | null;
  events?: LiveEvent[];
  recordingId?: string;
  status: "pending" | "uploading" | "done" | "failed";
  attempts: number;
  lastError?: string;
  nextAttemptAt?: number;
};

export class UploadQueue {
  items: QueueItem[] = [];
  constructor(private file: string) {
    if (existsSync(file)) this.items = JSON.parse(readFileSync(file, "utf8"));
    // Un envoi « en cours » au moment d'un arrêt brutal redevient « en attente ».
    for (const i of this.items) if (i.status === "uploading") i.status = "pending";
  }

  save() {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.items, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }

  add(item: Omit<QueueItem, "status" | "attempts">) {
    if (this.items.some((i) => i.id === item.id)) return;
    this.items.push({ ...item, status: "pending", attempts: 0 });
    this.save();
  }

  pending(now = Date.now()) {
    return this.items.filter((i) => i.status === "pending" && (i.nextAttemptAt ?? 0) <= now);
  }

  uploadedFiles() {
    return new Set(this.items.filter((i) => i.status === "done").map((i) => path.resolve(i.file)));
  }

  /** Envoie un élément ; renvoie true si terminé. Erreur temporaire → nouvel essai planifié. */
  async upload(api: CoachApi, item: QueueItem, opts: { deleteAfterUpload: boolean; onProgress?: (sent: number, total: number) => void }) {
    if (!existsSync(item.file)) {
      item.status = "failed";
      item.lastError = "Fichier local introuvable.";
      this.save();
      return false;
    }
    item.status = "uploading";
    item.attempts++;
    this.save();
    try {
      const size = statSync(item.file).size;
      const created = await api.createRecording({
        filename: path.basename(item.file),
        sizeBytes: size,
        mimeType: "video/mp4",
        title: item.title,
        gameStartOffsetMs: item.gameStartOffsetMs,
        capturedAt: item.capturedAt,
        clientUploadId: item.id,
      });
      item.recordingId = created.id;
      this.save();
      let offset = created.status === "UPLOADING" ? (await api.uploadState(created.id)).receivedBytes : size;
      while (offset < size) {
        try {
          const r = await api.putChunk(created.id, item.file, offset, Math.min(created.chunkSize, size - offset));
          offset = r.receivedBytes;
        } catch (e) {
          if (e instanceof ServerError && e.code === "offset_mismatch") {
            offset = (e.details as { receivedBytes: number }).receivedBytes;
            continue;
          }
          throw e;
        }
        opts.onProgress?.(offset, size);
      }
      if (item.activePlayer && item.events?.length && item.gameStartOffsetMs != null) {
        await api.liveEvents(created.id, item.activePlayer, item.events).catch(() => {}); // facultatif : n'empêche pas l'envoi
      }
      item.status = "done";
      item.lastError = undefined;
      this.save();
      if (opts.deleteAfterUpload) rmSync(item.file, { force: true });
      return true;
    } catch (e) {
      const permanent = e instanceof ServerError && e.permanent;
      item.status = permanent || item.attempts >= 20 ? "failed" : "pending";
      item.lastError = e instanceof Error ? e.message : String(e);
      item.nextAttemptAt = Date.now() + Math.min(15 * 60_000, 5000 * 2 ** Math.min(item.attempts, 8));
      this.save();
      return false;
    }
  }

  retryFailed() {
    for (const i of this.items) if (i.status === "failed" && existsSync(i.file)) Object.assign(i, { status: "pending", attempts: 0, nextAttemptAt: 0 });
    this.save();
  }

  /** Nettoyage : oublie les éléments envoyés depuis plus de 7 jours. */
  prune(now = Date.now()) {
    this.items = this.items.filter((i) => !(i.status === "done" && now - new Date(i.capturedAt).getTime() > 7 * 86400_000));
    this.save();
  }
}
