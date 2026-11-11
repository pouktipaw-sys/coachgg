// Stockage objet privé. Driver local (disque) en V1 ; l'interface permet de
// brancher un stockage S3-compatible sans toucher au reste du code.
// Les fichiers ne sont JAMAIS servis statiquement : uniquement via des routes
// qui vérifient les permissions.
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "@/lib/env";

const KEY_RE = /^[a-zA-Z0-9_\-./]+$/;

export interface StorageDriver {
  /** Chemin local (les traitements FFmpeg travaillent sur fichiers locaux). */
  localPath(key: string): string;
  size(key: string): Promise<number | null>;
  append(key: string, data: Uint8Array): Promise<void>;
  truncate(key: string, length: number): Promise<void>;
  readStream(key: string, range?: { start: number; end: number }): ReadableStream<Uint8Array>;
  importFile(key: string, sourcePath: string): Promise<void>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  usageBytes(prefix: string): Promise<number>;
}

function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error(`Clé de stockage invalide : ${key}`);
  }
}

class LocalDiskStorage implements StorageDriver {
  constructor(private root: string) {}

  localPath(key: string) {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Chemin hors du stockage");
    return full;
  }

  async size(key: string) {
    try {
      return (await fs.stat(this.localPath(key))).size;
    } catch {
      return null;
    }
  }

  async append(key: string, data: Uint8Array) {
    const p = this.localPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, data);
  }

  async truncate(key: string, length: number) {
    const p = this.localPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    // Pas de fichier ouvert en mode « ajout » : sous Windows, il ne peut pas être tronqué (EPERM).
    try {
      await fs.truncate(p, length);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      await fs.writeFile(p, new Uint8Array(0));
      if (length > 0) await fs.truncate(p, length);
    }
  }

  readStream(key: string, range?: { start: number; end: number }) {
    const node = createReadStream(this.localPath(key), range ? { start: range.start, end: range.end } : {});
    return Readable.toWeb(node) as ReadableStream<Uint8Array>;
  }

  async importFile(key: string, sourcePath: string) {
    const dest = this.localPath(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.rename(sourcePath, dest);
    } catch {
      await fs.copyFile(sourcePath, dest);
      await fs.rm(sourcePath, { force: true });
    }
  }

  async delete(key: string) {
    await fs.rm(this.localPath(key), { force: true });
  }

  async deletePrefix(prefix: string) {
    const p = this.localPath(prefix.replace(/\/$/, ""));
    await fs.rm(p, { recursive: true, force: true });
  }

  async usageBytes(prefix: string) {
    const dir = this.localPath(prefix.replace(/\/$/, ""));
    let total = 0;
    async function walk(d: string) {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else total += (await fs.stat(p)).size;
      }
    }
    await walk(dir);
    return total;
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) driver = new LocalDiskStorage(path.resolve(env.storageDir));
  return driver;
}

export const recordingPrefix = (ownerId: string, recordingId: string) => `recordings/${ownerId}/${recordingId}/`;
