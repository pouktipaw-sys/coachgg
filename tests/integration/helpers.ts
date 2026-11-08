import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { appendChunk, createUpload } from "@/server/video/uploads";
import { drain } from "@/worker/index";

let pwHash: string | null = null;
export async function makeUser(name: string) {
  pwHash ??= await hashPassword("motdepasse-test");
  return prisma.user.create({
    data: { email: `${name.toLowerCase()}-${Math.random().toString(36).slice(2)}@test.dev`, displayName: name, passwordHash: pwHash, profile: { create: {} } },
  });
}

export const fixture = (name: string) => path.resolve(__dirname, "../fixtures/generated", name);

/** Envoie un vrai fichier par morceaux puis exécute le worker. */
export async function uploadFile(userId: string, file: string, opts: { chunk?: number; process?: boolean } = {}) {
  const buf = await readFile(fixture(file));
  const { id, chunkSize } = await createUpload(userId, { filename: file, sizeBytes: buf.byteLength, mimeType: "" });
  const size = Math.min(opts.chunk ?? chunkSize, chunkSize);
  for (let off = 0; off < buf.byteLength; off += size) {
    await appendChunk(userId, id, off, new Uint8Array(buf.subarray(off, off + size)));
  }
  if (opts.process !== false) await drain();
  return id;
}
