import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { storage } from "@/server/storage";
import { appendChunk, createUpload, deleteRecording, uploadState } from "@/server/video/uploads";
import { claimNextJob, enqueueJob, failJob, PermanentJobError } from "@/server/jobs";
import { drain } from "@/worker/index";
import { fixture, makeUser, uploadFile } from "./helpers";

describe("pipeline vidéo (fichiers réels, FFmpeg réel)", () => {
  it("importe un MP4 H.264 par morceaux, le remuxe et produit une miniature", async () => {
    const u = await makeUser("Alice");
    const id = await uploadFile(u.id, "sample.mp4", { chunk: 1024 * 1024 });
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id } });
    expect(rec.status).toBe("READY");
    expect(rec.durationMs).toBeGreaterThan(19_000);
    expect(rec.width).toBe(1280);
    expect(rec.videoCodec).toBe("h264");
    expect(await storage().size(rec.playbackKey!)).toBeGreaterThan(1000);
    expect(await storage().size(rec.thumbnailKey!)).toBeGreaterThan(100);
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id } });
    expect(job.status).toBe("SUCCEEDED");
    expect(job.processingMs).toBeGreaterThanOrEqual(0);
    const notif = await prisma.notification.findFirst({ where: { userId: u.id, type: "recording_ready" } });
    expect(notif).not.toBeNull();
  });

  it("transcode un WEBM VP9 en MP4 H.264 lisible", async () => {
    const u = await makeUser("Bob");
    const id = await uploadFile(u.id, "sample.webm");
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id } });
    expect(rec.status).toBe("READY");
    expect(rec.playbackKey).toMatch(/playback\.mp4$/);
    expect(rec.originalKey).toMatch(/original\.webm$/);
  });

  it("refuse un fichier dont le contenu ne correspond pas à l'extension", async () => {
    const u = await makeUser("Eve");
    const html = new TextEncoder().encode("<html>".padEnd(4096, "x"));
    const { id } = await createUpload(u.id, { filename: "faux.mp4", sizeBytes: html.byteLength });
    await expect(appendChunk(u.id, id, 0, html)).rejects.toThrow(/ne correspond pas/);
    expect((await prisma.recording.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
  });

  it("refuse les formats non pris en charge et les fichiers trop gros", async () => {
    const u = await makeUser("Eve");
    await expect(createUpload(u.id, { filename: "x.avi", sizeBytes: 5000 })).rejects.toThrow(/Format/);
    await expect(createUpload(u.id, { filename: "x.mp4", sizeBytes: 10 * 1024 ** 4 })).rejects.toThrow(/volumineux/);
  });

  it("marque en échec définitif un fichier corrompu, sans nouvelle tentative", async () => {
    const u = await makeUser("Carl");
    const id = await uploadFile(u.id, "corrupt.mp4");
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id } });
    expect(rec.status).toBe("FAILED");
    expect(rec.errorMessage).toMatch(/illisible|corrompu|piste/i);
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id } });
    expect(job.status).toBe("FAILED");
    expect(job.attempts).toBe(1);
  });

  it("reprend un envoi interrompu à partir de l'offset serveur", async () => {
    const u = await makeUser("Dana");
    const buf = await readFile(fixture("sample.mp4"));
    const { id } = await createUpload(u.id, { filename: "sample.mp4", sizeBytes: buf.byteLength });
    const half = 3 * 1024 * 1024;
    await appendChunk(u.id, id, 0, new Uint8Array(buf.subarray(0, half)));
    // « coupure » : le client renvoie un mauvais offset → 409 avec la position réelle
    await expect(appendChunk(u.id, id, 0, new Uint8Array(buf.subarray(0, 1024)))).rejects.toMatchObject({ status: 409 });
    const state = await uploadState(u.id, id);
    expect(state.receivedBytes).toBe(half);
    for (let off = state.receivedBytes; off < buf.byteLength; off += 4 * 1024 * 1024) {
      await appendChunk(u.id, id, off, new Uint8Array(buf.subarray(off, off + 4 * 1024 * 1024)));
    }
    await drain();
    expect((await prisma.recording.findUniqueOrThrow({ where: { id } })).status).toBe("READY");
  });

  it("réaligne le fichier si une écriture a été interrompue après l'append", async () => {
    const u = await makeUser("Dana");
    const buf = await readFile(fixture("sample.mp4"));
    const { id } = await createUpload(u.id, { filename: "sample.mp4", sizeBytes: buf.byteLength });
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id } });
    await appendChunk(u.id, id, 0, new Uint8Array(buf.subarray(0, 1024 * 1024)));
    await storage().append(rec.originalKey, new Uint8Array(500)); // octets orphelins
    for (let off = 1024 * 1024; off < buf.byteLength; off += 4 * 1024 * 1024) {
      await appendChunk(u.id, id, off, new Uint8Array(buf.subarray(off, off + 4 * 1024 * 1024)));
    }
    await drain();
    const done = await prisma.recording.findUniqueOrThrow({ where: { id } });
    expect(done.status).toBe("READY");
  });

  it("interdit à un autre utilisateur d'écrire dans l'envoi", async () => {
    const a = await makeUser("A");
    const b = await makeUser("B");
    const { id } = await createUpload(a.id, { filename: "x.mp4", sizeBytes: 5000 });
    await expect(appendChunk(b.id, id, 0, new Uint8Array(10))).rejects.toMatchObject({ status: 404 });
  });

  it("supprime fichiers et données associées", async () => {
    const u = await makeUser("Fay");
    const id = await uploadFile(u.id, "sample.webm");
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id } });
    await deleteRecording(u.id, id);
    expect(await prisma.recording.findUnique({ where: { id } })).toBeNull();
    expect(await storage().size(rec.playbackKey!)).toBeNull();
    expect(await prisma.analysisJob.count({ where: { recordingId: id } })).toBe(0);
  });

  it("applique le quota d'envois simultanés", async () => {
    const u = await makeUser("Gil");
    for (let i = 0; i < 3; i++) await createUpload(u.id, { filename: `x${i}.mp4`, sizeBytes: 5000 });
    await expect(createUpload(u.id, { filename: "x4.mp4", sizeBytes: 5000 })).rejects.toMatchObject({ status: 429 });
  });
});

describe("file de tâches", () => {
  it("est idempotente sur la clé", async () => {
    const a = await enqueueJob({ type: "PROCESS_RECORDING", idempotencyKey: "k1" });
    const b = await enqueueJob({ type: "PROCESS_RECORDING", idempotencyKey: "k1" });
    expect(a.id).toBe(b.id);
    expect(await prisma.analysisJob.count()).toBe(1);
  });

  it("replanifie avec backoff une erreur temporaire, puis échoue après le maximum", async () => {
    await enqueueJob({ type: "PROCESS_RECORDING", idempotencyKey: "k2", maxAttempts: 2 });
    let job = (await claimNextJob("t"))!;
    expect(await failJob(job, new Error("réseau"))).toBe("retry");
    let row = await prisma.analysisJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("PENDING");
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now());
    await prisma.analysisJob.update({ where: { id: job.id }, data: { runAfter: new Date() } });
    job = (await claimNextJob("t"))!;
    expect(job.attempts).toBe(2);
    expect(await failJob(job, new Error("réseau"))).toBe("failed");
    row = await prisma.analysisJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("FAILED");
  });

  it("n'attribue jamais la même tâche à deux workers", async () => {
    await enqueueJob({ type: "PROCESS_RECORDING", idempotencyKey: "k3" });
    const [a, b] = await Promise.all([claimNextJob("w1"), claimNextJob("w2")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("une erreur permanente ne se relance pas", async () => {
    await enqueueJob({ type: "PROCESS_RECORDING", idempotencyKey: "k4" });
    const job = (await claimNextJob("t"))!;
    expect(await failJob(job, new PermanentJobError("corrompu"))).toBe("failed");
  });
});
