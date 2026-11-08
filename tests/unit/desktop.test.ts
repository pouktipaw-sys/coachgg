// Agent PC : logique testée sous Linux avec la source FFmpeg « testsrc »
// (la capture gdigrab réelle ne peut être testée que sous Windows).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRecordArgs, frameLuma, isBlankFrame, startRecording } from "../../desktop/src/recorder";
import { clipWindows, relevantEvents } from "../../desktop/src/clips";
import { GameWatcher, parseEvents, type GameProbe, type LiveEvent } from "../../desktop/src/liveclient";
import { enforceDiskLimit } from "../../desktop/src/storage";
import { UploadQueue } from "../../desktop/src/queue";
import { CoachApi } from "../../desktop/src/api";
import { Agent } from "../../desktop/src/agent";
import { configSchema } from "../../desktop/src/config";
import { startLocalUi } from "../../desktop/src/localui";
import { testRecording } from "../../desktop/src/diagnostics";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "cgg-desk-"));
const cfg = (over: object = {}) => configSchema.parse({ capture: { backend: "testsrc", fps: 15, maxHeight: 360 }, ...over });
const ffprobeDuration = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout);

describe("arguments de capture", () => {
  it("gdigrab : fenêtre du jeu uniquement, sans audio, MP4 fragmenté", () => {
    const a = buildRecordArgs("gdigrab", cfg().capture, "out.mp4", { maxBytes: 1000 });
    expect(a).toContain("gdigrab");
    expect(a).toContain("title=League of Legends (TM) Client");
    expect(a).toContain("-an");
    expect(a.join(" ")).not.toMatch(/dshow|audio=|video=/); // ni micro ni webcam
    expect(a.join(" ")).toMatch(/frag_keyframe/);
    expect(a).toContain("-fs");
  });
  it("refuse toute activation du micro ou de la webcam dans la configuration", () => {
    expect(() => configSchema.parse({ capture: { microphone: true } })).toThrow();
    expect(() => configSchema.parse({ capture: { webcam: true } })).toThrow();
  });
});

describe("API locale du client (lecture seule)", () => {
  it("convertit les événements", () => {
    expect(parseEvents({ Events: [{ EventName: "ChampionKill", EventTime: 61.5, KillerName: "A", VictimName: "Moi#EUW", Assisters: [] }] })).toEqual([
      { name: "ChampionKill", gameTimeMs: 61500, killer: "A", victim: "Moi#EUW", assisters: [] },
    ]);
    expect(parseEvents(null)).toEqual([]);
  });

  function fakeProbe(seq: (number | null)[], events: LiveEvent[][] = []): GameProbe {
    let i = 0;
    let j = 0;
    return {
      gameTime: async () => seq[Math.min(i++, seq.length - 1)] ?? null,
      events: async () => events[Math.min(j++, Math.max(0, events.length - 1))] ?? [],
      activePlayer: async () => "Moi#EUW",
    };
  }

  it("détecte le début, accumule les événements et détecte la fin par GameEnd", async () => {
    const w = new GameWatcher(fakeProbe([null, 30, 31, 32], [[{ name: "GameStart", gameTimeMs: 0 }], [{ name: "GameStart", gameTimeMs: 0 }, { name: "GameEnd", gameTimeMs: 1800000 }]]));
    expect(await w.tick()).toBeNull();
    expect(await w.tick()).toEqual({ type: "start", gameTimeSec: 30 });
    expect(w.activePlayer).toBe("Moi#EUW");
    expect(await w.tick()).toBeNull();
    expect(await w.tick()).toEqual({ type: "end", reason: "game_end_event" });
    expect(w.lastEvents).toHaveLength(2);
  });

  it("détecte la fin quand le client disparaît (3 sondages sans réponse), en tolérant une coupure brève", async () => {
    const w = new GameWatcher(fakeProbe([10, null, 12, null, null, null]));
    expect((await w.tick())?.type).toBe("start");
    expect(await w.tick()).toBeNull(); // coupure brève
    expect(await w.tick()).toBeNull();
    expect(await w.tick()).toBeNull();
    expect(await w.tick()).toBeNull();
    expect(await w.tick()).toEqual({ type: "end", reason: "client_gone" });
  });
});

describe("découpage après match", () => {
  const ev: LiveEvent[] = [
    { name: "ChampionKill", gameTimeMs: 300_000, killer: "Ennemi", victim: "Moi" },
    { name: "ChampionKill", gameTimeMs: 310_000, killer: "Moi#EUW", victim: "X" },
    { name: "ChampionKill", gameTimeMs: 600_000, killer: "A", victim: "B", assisters: ["moi#euw"] },
    { name: "ChampionKill", gameTimeMs: 700_000, killer: "A", victim: "B" }, // ne concerne pas le joueur
    { name: "DragonKill", gameTimeMs: 900_000, killer: "Moi#EUW" },
  ];
  it("ne retient que les événements du joueur (nom avec ou sans #TAG)", () => {
    expect(relevantEvents(ev, "Moi#EUW").map((e) => e.reason)).toEqual(["mort", "élimination", "assistance", "objectif"]);
    expect(relevantEvents(ev, null)).toEqual([]);
  });
  it("calcule des fenêtres en temps vidéo, fusionne les chevauchements et borne à la vidéo", () => {
    const w = clipWindows(relevantEvents(ev, "Moi#EUW"), { gameStartOffsetMs: -60_000, durationMs: 850_000, beforeMs: 15_000, afterMs: 5_000 });
    expect(w[0]).toEqual({ startMs: 225_000, endMs: 255_000, reasons: ["mort", "élimination"] });
    expect(w[1]).toEqual({ startMs: 525_000, endMs: 545_000, reasons: ["assistance"] });
    expect(w[2]).toEqual({ startMs: 825_000, endMs: 845_000, reasons: ["objectif"] });
  });
});

describe("espace disque", () => {
  it("ne supprime que des fichiers déjà envoyés, du plus ancien au plus récent", () => {
    const d = tmp();
    const mk = (n: string, size: number, t: number) => {
      const p = path.join(d, n);
      writeFileSync(p, Buffer.alloc(size));
      spawnSync("touch", ["-d", `@${t}`, p]);
      return p;
    };
    const a = mk("a.mp4", 400, 1000);
    const b = mk("b.mp4", 400, 2000);
    mk("c.mp4", 400, 3000);
    const removed = enforceDiskLimit(d, 900, new Set([a, b]));
    expect(removed).toEqual([a]);
    expect(readdirSync(d).sort()).toEqual(["b.mp4", "c.mp4"]);
    expect(enforceDiskLimit(d, 100, new Set())).toEqual([]); // rien d'envoyé : rien supprimé
  });
});

describe("enregistrement FFmpeg (source de test)", () => {
  it("produit une vidéo exploitable et la détecte comme non vide", async () => {
    const out = path.join(tmp(), "t.mp4");
    const h = startRecording("testsrc", cfg().capture, out, { durationSec: 2 });
    await h.done;
    expect(statSync(out).size).toBeGreaterThan(10_000);
    expect(isBlankFrame(await frameLuma(out, 1))).toBe(false);
  });

  it("un enregistrement tué brutalement reste lisible (MP4 fragmenté)", async () => {
    const out = path.join(tmp(), "crash.mp4");
    const h = startRecording("testsrc", cfg().capture, out);
    await new Promise((r) => setTimeout(r, 2500));
    spawnSync("pkill", ["-9", "-f", out]);
    await h.done;
    expect(ffprobeDuration(out)).toBeGreaterThan(0.5);
  });

  it("le test d'enregistrement signale une image noire", async () => {
    expect(isBlankFrame({ mean: 0, std: 0.2 })).toBe(true);
    const r = await testRecording(cfg(), 2);
    expect(r.ok).toBe(true);
    const none = await testRecording(cfg({ capture: { backend: "none" } }), 2);
    expect(none.message).toMatch(/Windows/);
  });
});

// Faux serveur CoachGG minimal pour tester la file d'envoi de bout en bout.
function fakeServer(opts: { failFirstChunks?: number; permanent?: boolean } = {}) {
  const recs = new Map<string, { size: number; received: number; key: string }>();
  const calls: string[] = [];
  let fails = opts.failFirstChunks ?? 0;
  const server = http.createServer((req, res) => {
    let body: Buffer[] = [];
    req.on("data", (d) => body.push(d));
    req.on("end", () => {
      const buf = Buffer.concat(body);
      calls.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
      const send = (c: number, j: unknown) => res.writeHead(c, { "Content-Type": "application/json" }).end(JSON.stringify(j));
      if (opts.permanent) return send(413, { error: "storage_quota", message: "Espace insuffisant" });
      if (req.method === "POST" && req.url === "/api/recordings") {
        const j = JSON.parse(buf.toString());
        const existing = [...recs.entries()].find(([, r]) => r.key === j.clientUploadId);
        if (existing) return send(201, { id: existing[0], chunkSize: 4096, receivedBytes: existing[1].received, status: existing[1].received === existing[1].size ? "UPLOADED" : "UPLOADING" });
        const id = `r${recs.size + 1}`;
        recs.set(id, { size: j.sizeBytes, received: 0, key: j.clientUploadId });
        return send(201, { id, chunkSize: 4096, receivedBytes: 0, status: "UPLOADING" });
      }
      const m = req.url?.match(/^\/api\/recordings\/(\w+)\/(upload|live-events)$/);
      const r = m ? recs.get(m[1]!) : undefined;
      if (r && m![2] === "upload" && req.method === "GET") return send(200, { status: "UPLOADING", receivedBytes: r.received, sizeBytes: r.size, chunkSize: 4096 });
      if (r && m![2] === "upload" && req.method === "PUT") {
        if (fails-- > 0) return send(503, { error: "unavailable", message: "indisponible" });
        const off = Number(req.headers["upload-offset"]);
        if (off !== r.received) return send(409, { error: "offset_mismatch", message: "décalage", details: { receivedBytes: r.received } });
        r.received += buf.length;
        return send(200, { receivedBytes: r.received, complete: r.received === r.size });
      }
      if (r && m![2] === "live-events") return send(200, { deaths: 1 });
      if (req.url === "/api/devices/heartbeat") return send(200, { ok: true });
      send(404, {});
    });
  });
  return new Promise<{ url: string; recs: typeof recs; calls: string[]; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, recs, calls, close: () => server.close() });
    }),
  );
}

describe("file d'envoi persistante", () => {
  let close: (() => void) | null = null;
  afterEach(() => close?.());

  it("envoie par morceaux, reprend après une erreur temporaire et survit à un redémarrage", async () => {
    const srv = await fakeServer({ failFirstChunks: 1 });
    close = srv.close;
    const d = tmp();
    const file = path.join(d, "v.mp4");
    writeFileSync(file, Buffer.alloc(10_000, 7));
    const q = new UploadQueue(path.join(d, "queue.json"));
    q.add({ id: "clip-abcdef12", file, title: "Partie", sizeBytes: 10_000, capturedAt: new Date().toISOString(), gameStartOffsetMs: -30_000, activePlayer: "Moi", events: [{ name: "ChampionKill", gameTimeMs: 1, victim: "Moi" }] });
    const api = new CoachApi(srv.url, "cgd_token");
    expect(await q.upload(api, q.items[0]!, { deleteAfterUpload: false })).toBe(false); // 503 au 1er morceau
    expect(q.items[0]!.status).toBe("pending");
    expect(q.items[0]!.nextAttemptAt).toBeGreaterThan(Date.now());

    const reloaded = new UploadQueue(path.join(d, "queue.json")); // « redémarrage »
    expect(await reloaded.upload(api, reloaded.items[0]!, { deleteAfterUpload: true })).toBe(true);
    expect(srv.recs.size).toBe(1); // idempotent : pas de doublon côté serveur
    expect([...srv.recs.values()][0]!.received).toBe(10_000);
    expect(srv.calls.some((c) => c.includes("live-events"))).toBe(true);
    expect(srv.calls.every((c) => c.endsWith("Bearer cgd_token"))).toBe(true);
    expect(existsSync(file)).toBe(false); // nettoyage après envoi
  });

  it("marque en échec une erreur définitive (quota) sans boucler", async () => {
    const srv = await fakeServer({ permanent: true });
    close = srv.close;
    const d = tmp();
    const file = path.join(d, "v.mp4");
    writeFileSync(file, Buffer.alloc(5000));
    const q = new UploadQueue(path.join(d, "queue.json"));
    q.add({ id: "clip-abcdef13", file, title: "P", sizeBytes: 5000, capturedAt: new Date().toISOString() });
    await q.upload(new CoachApi(srv.url, "cgd_t"), q.items[0]!, { deleteAfterUpload: true });
    expect(q.items[0]!.status).toBe("failed");
    expect(q.items[0]!.lastError).toMatch(/Espace/);
    expect(existsSync(file)).toBe(true); // jamais supprimé sans envoi réussi
  });
});

describe("agent complet (partie simulée, capture testsrc)", () => {
  let close: (() => void) | null = null;
  afterEach(() => close?.());

  function scripted(times: (number | null)[], events: LiveEvent[]): GameProbe {
    let i = 0;
    return { gameTime: async () => times[Math.min(i++, times.length - 1)] ?? null, events: async () => events, activePlayer: async () => "Moi#EUW" };
  }

  it("enregistre la partie, calcule la synchronisation et l'envoie", async () => {
    const srv = await fakeServer();
    close = srv.close;
    const home = tmp();
    const a = new Agent(cfg({ deviceToken: "cgd_x", serverUrl: srv.url }), { home, probe: scripted([null, 42.5, 44, null, null, null], []), log: () => {} });
    await a.tick();
    await a.tick();
    expect(a.state).toBe("recording");
    expect(existsSync(path.join(home, "current-recording.json"))).toBe(true);
    await new Promise((r) => setTimeout(r, 2000));
    for (let k = 0; k < 4; k++) await a.tick();
    expect(a.state).toBe("idle");
    const item = a.queue.items[0]!;
    expect(item.gameStartOffsetMs).toBe(-42_500); // vidéo démarrée à 0:42.5 de jeu
    expect(ffprobeDuration(item.file)).toBeGreaterThan(1);
    await a.processQueue();
    expect(a.queue.items[0]!.status).toBe("done");
    expect(srv.recs.size).toBe(1);
  });

  it("mode séquences : découpe autour des événements du joueur et ajuste la synchronisation", async () => {
    const home = tmp();
    const events: LiveEvent[] = [{ name: "ChampionKill", gameTimeMs: 3_000, killer: "E", victim: "Moi" }];
    const a = new Agent(cfg({ upload: { mode: "clips", clipBeforeSec: 5, clipAfterSec: 2 } }), { home, probe: scripted([null, 0, 1, 2, null, null, null], events), log: () => {} });
    await a.tick();
    await a.tick();
    await new Promise((r) => setTimeout(r, 6000));
    for (let k = 0; k < 5; k++) await a.tick();
    expect(a.queue.items).toHaveLength(1);
    const clip = a.queue.items[0]!;
    expect(clip.title).toMatch(/mort/);
    expect(clip.gameStartOffsetMs).toBe(0); // fenêtre [0 s ; 5 s] : le clip commence à 0:00 de jeu
    expect(ffprobeDuration(clip.file)).toBeGreaterThan(2);
    expect(readdirSync(a.dir).filter((f) => !f.includes("clip"))).toEqual([]); // original supprimé
  }, 30_000);

  it("récupère un enregistrement interrompu au redémarrage", () => {
    const home = tmp();
    const dir = path.join(home, "recordings");
    const a0 = new Agent(cfg(), { home, log: () => {} });
    const file = path.join(dir, "partie-x.mp4");
    writeFileSync(file, Buffer.alloc(20_000));
    writeFileSync(path.join(home, "current-recording.json"), JSON.stringify({ file, startedAt: new Date().toISOString(), gameTimeAtStartSec: 12 }));
    expect(a0.recoverInterrupted()).toBe(file);
    expect(a0.queue.items[0]).toMatchObject({ gameStartOffsetMs: -12_000, title: expect.stringMatching(/interrompu/) });
  });

  it("refuse d'enregistrer sans méthode de capture et le signale", async () => {
    const a = new Agent(cfg({ capture: { backend: "none" } }), { home: tmp(), log: () => {} });
    await a.tick();
    expect(a.state).toBe("error");
    expect(a.message).toMatch(/Windows/);
  });
});

describe("interface locale", () => {
  it("exige l'en-tête Host local et le jeton de lancement", async () => {
    const a = new Agent(cfg(), { home: tmp(), log: () => {} });
    const ui = startLocalUi(a, { port: 47912, home: tmp() });
    await new Promise((r) => setTimeout(r, 100));
    const req = (p: string, headers: Record<string, string> = {}) =>
      new Promise<number>((resolve) => http.get({ host: "127.0.0.1", port: 47912, path: p, headers }, (r) => resolve(r.statusCode ?? 0)).on("error", () => resolve(0)));
    expect(await req("/")).toBe(403);
    expect(await req(`/?t=${ui.token}`)).toBe(200);
    expect(await req("/api/status")).toBe(403);
    expect(await req("/api/status", { "X-CoachGG-Token": ui.token })).toBe(200);
    expect(await req(`/?t=${ui.token}`, { Host: "evil.example:47912" })).toBe(421);
    ui.server.close();
  });
});
