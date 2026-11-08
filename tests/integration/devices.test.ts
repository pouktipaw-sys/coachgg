import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createPairingCode, deviceFromAuthHeader, deviceHeartbeat, ingestLiveEvents, listDevices, pairDevice, revokeDevice, samePlayer } from "@/server/devices";
import { appendChunk, createUpload } from "@/server/video/uploads";
import { evaluateRecording } from "@/server/analysis/evaluation";
import { analyzerAvailable } from "@/server/analysis/runner";
import { drain } from "@/worker/index";
import { fixture, makeUser } from "./helpers";

const pairInput = (code: string) => ({ code, name: "PC salon", platform: "windows", appVersion: "0.1.0" });

describe("appairage des PC", () => {
  it("échange un code à usage unique contre un jeton d'appareil haché et révocable", async () => {
    const u = await makeUser("Ana");
    const { code, expiresAt } = await createPairingCode(u.id);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    const { token, device } = await pairDevice(pairInput(code.toLowerCase().replace("-", " "))); // saisie tolérante
    expect(token).toMatch(/^cgd_/);
    expect(await prisma.device.count({ where: { tokenHash: token } })).toBe(0); // jeton brut jamais stocké
    await expect(pairDevice(pairInput(code))).rejects.toThrow(/invalide ou expiré/); // usage unique
    expect((await deviceFromAuthHeader(`Bearer ${token}`))?.id).toBe(device.id);
    expect(await deviceFromAuthHeader("Bearer cgd_faux_jeton_de_test_123456")).toBeNull();
    expect(await deviceFromAuthHeader(token)).toBeNull(); // sans « Bearer »
    await revokeDevice(u.id, device.id);
    expect(await deviceFromAuthHeader(`Bearer ${token}`)).toBeNull();
  });

  it("refuse un code expiré, limite les codes actifs et le nombre d'appareils", async () => {
    const u = await makeUser("Ana");
    const { code } = await createPairingCode(u.id);
    await prisma.devicePairingCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(pairDevice(pairInput(code))).rejects.toThrow(/expiré/);
    for (let i = 0; i < 5; i++) await createPairingCode(u.id);
    await expect(createPairingCode(u.id)).rejects.toMatchObject({ status: 429 });
  });

  it("un utilisateur ne peut pas révoquer l'appareil d'un autre", async () => {
    const a = await makeUser("Ana");
    const b = await makeUser("Bob");
    const { device } = await pairDevice(pairInput((await createPairingCode(a.id)).code));
    await expect(revokeDevice(b.id, device.id)).rejects.toMatchObject({ status: 404 });
    expect(await listDevices(b.id)).toHaveLength(0);
  });

  it("enregistre l'état de capture signalé", async () => {
    const u = await makeUser("Ana");
    const { token } = await pairDevice(pairInput((await createPairingCode(u.id)).code));
    const d = (await deviceFromAuthHeader(`Bearer ${token}`))!;
    await deviceHeartbeat(d, { state: "recording", queue: 2, diskUsedBytes: 1e9, diskLimitBytes: 2e10, captureBackend: "gdigrab" });
    const [row] = await listDevices(u.id);
    expect(row!.status).toMatchObject({ state: "recording", queue: 2 });
    await expect(deviceHeartbeat(d, { state: "piratage" })).rejects.toThrow();
  });
});

describe("envoi depuis l'application PC", () => {
  it("crée une vidéo « capture PC » synchronisée, de façon idempotente, puis exploite les événements de partie", async () => {
    const u = await makeUser("Ana");
    const { token } = await pairDevice(pairInput((await createPairingCode(u.id)).code));
    const device = (await deviceFromAuthHeader(`Bearer ${token}`))!;
    const buf = await readFile(fixture("analysis.mp4"));
    const body = { filename: "partie.mp4", sizeBytes: buf.byteLength, mimeType: "video/mp4", title: "Partie", gameStartOffsetMs: -2000, capturedAt: new Date().toISOString(), clientUploadId: "agent-0001-abcd" };
    const first = await createUpload(u.id, body, device);
    await appendChunk(u.id, first.id, 0, new Uint8Array(buf.subarray(0, 1024 * 1024)));
    // l'agent redémarre et recrée : même enregistrement, reprise à l'octet près
    const again = await createUpload(u.id, body, device);
    expect(again.id).toBe(first.id);
    expect(again.receivedBytes).toBe(1024 * 1024);
    for (let off = again.receivedBytes; off < buf.byteLength; off += 4 * 1024 * 1024)
      await appendChunk(u.id, first.id, off, new Uint8Array(buf.subarray(off, off + 4 * 1024 * 1024)));
    await drain();
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id: first.id } });
    expect(rec).toMatchObject({ status: "READY", source: "DESKTOP_CAPTURE", deviceId: device.id, gameStartOffsetMs: -2000 });

    // Mort à 15 s de jeu → 13 s de vidéo ; l'écran grisé de la vidéo de test commence à 13 s.
    const r = await ingestLiveEvents(u.id, first.id, {
      activePlayer: "Ana#EUW",
      events: [
        { name: "ChampionKill", gameTimeMs: 15_000, killer: "Ennemi", victim: "Ana" },
        { name: "ChampionKill", gameTimeMs: 20_000, killer: "Ana#EUW", victim: "X" },
      ],
    });
    expect(r.deaths).toBe(1);
    const truth = await prisma.groundTruthEvent.findMany({ where: { recordingId: first.id } });
    expect(truth.map((t) => [t.videoMs, t.source])).toEqual([[13_000, "LIVE_CLIENT"]]);
    // L'analyse assistée s'est enchaînée (si Python/OpenCV est disponible) : la mort est retrouvée.
    if ((await analyzerAvailable()).ok) {
      const ev = await evaluateRecording(first.id);
      expect(ev.status).toBe("ok");
      expect(ev.status === "ok" && ev.truthSource).toBe("LIVE_CLIENT");
      expect(ev.status === "ok" && ev.result.tp).toBe(1);
    }
  });

  it("un envoi via le navigateur reste « import manuel » et ignore la clé d'idempotence", async () => {
    const u = await makeUser("Ana");
    const r = await createUpload(u.id, { filename: "x.mp4", sizeBytes: 5000, clientUploadId: "agent-0002-abcd" });
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id: r.id } });
    expect(rec).toMatchObject({ source: "MANUAL_UPLOAD", deviceId: null, clientUploadId: null });
  });

  it("compare les noms de joueur avec ou sans #TAG", () => {
    expect(samePlayer("Ana#EUW", "ana")).toBe(true);
    expect(samePlayer("Ana#EUW", "Anabelle")).toBe(false);
    expect(samePlayer(null, "Ana")).toBe(false);
  });
});
