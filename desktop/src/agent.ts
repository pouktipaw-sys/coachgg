// Orchestration de l'agent :
// partie détectée → enregistrement de la fenêtre du jeu → fin de partie →
// (découpage) → file d'envoi persistante → envoi reprenable → nettoyage.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CoachApi } from "./api";
import { clipWindows, cutClip, relevantEvents } from "./clips";
import { AGENT_VERSION, appHome, resolveBackend, storageDir, type AgentConfig } from "./config";
import { GameWatcher, LiveClientProbe, type GameProbe } from "./liveclient";
import { startRecording, type RecordingHandle } from "./recorder";
import { availableForRecording, enforceDiskLimit, usedBytes } from "./storage";
import { UploadQueue } from "./queue";

export type AgentState = "idle" | "waiting_game" | "recording" | "processing" | "uploading" | "error";

type Current = { file: string; startedAt: string; gameTimeAtStartSec: number; handle?: RecordingHandle };

/** Temps vidéo (ms) correspondant à 00:00 en jeu, la vidéo ayant démarré à `gameTimeSec` de jeu. */
export function offsetFromGameTime(gameTimeSec: number) {
  return Math.round(-gameTimeSec * 1000) + 0; // « + 0 » normalise -0 en 0
}

export class Agent {
  state: AgentState = "idle";
  message = "";
  readonly dir: string;
  readonly queue: UploadQueue;
  private watcher: GameWatcher;
  private current: Current | null = null;
  private timers: NodeJS.Timeout[] = [];
  private busy = false;
  log: (msg: string) => void;

  constructor(
    public cfg: AgentConfig,
    opts: { home?: string; probe?: GameProbe; api?: CoachApi; log?: (m: string) => void } = {},
  ) {
    const home = opts.home ?? appHome();
    this.dir = storageDir(cfg, home);
    mkdirSync(this.dir, { recursive: true });
    this.queue = new UploadQueue(path.join(home, "queue.json"));
    this.watcher = new GameWatcher(opts.probe ?? new LiveClientProbe(cfg.liveClient.url));
    this.api = opts.api ?? new CoachApi(cfg.serverUrl, cfg.deviceToken);
    this.log = opts.log ?? ((m) => console.log(`[agent] ${m}`));
    this.markerPath = path.join(home, "current-recording.json");
  }
  private api: CoachApi;
  private markerPath: string;

  get backend() {
    return resolveBackend(this.cfg);
  }

  status() {
    return {
      state: this.state,
      message: this.message,
      queue: this.queue.items.filter((i) => i.status === "pending" || i.status === "uploading").length,
      diskUsedBytes: usedBytes(this.dir),
      diskLimitBytes: this.cfg.storage.maxDiskBytes,
      captureBackend: this.backend,
      appVersion: AGENT_VERSION,
    };
  }

  /** Reprise après interruption : un enregistrement laissé par un arrêt brutal est mis en file (MP4 fragmenté lisible). */
  recoverInterrupted() {
    if (!existsSync(this.markerPath)) return null;
    const m = JSON.parse(readFileSync(this.markerPath, "utf8")) as Current;
    rmSync(this.markerPath, { force: true });
    if (!existsSync(m.file) || statSync(m.file).size < 10_000) return null;
    this.queue.add({
      id: randomUUID(),
      file: m.file,
      title: `Partie du ${new Date(m.startedAt).toLocaleString("fr-FR")} (enregistrement interrompu)`,
      sizeBytes: statSync(m.file).size,
      capturedAt: m.startedAt,
      gameStartOffsetMs: offsetFromGameTime(m.gameTimeAtStartSec),
    });
    this.log(`enregistrement interrompu récupéré : ${path.basename(m.file)}`);
    return m.file;
  }

  /** Un sondage de la machine à états (appelé périodiquement). */
  async tick() {
    if (this.backend === "none") {
      this.setState("error", "Aucune méthode de capture disponible sur ce système (Windows requis pour la capture du jeu).");
      return;
    }
    const ev = await this.watcher.tick();
    if (ev?.type === "start") await this.onGameStart(ev.gameTimeSec);
    else if (ev?.type === "end") await this.onGameEnd();
    else if (!this.current && this.state !== "uploading" && this.state !== "processing") this.setState("waiting_game", "En attente d'une partie.");
  }

  private async onGameStart(gameTimeSec: number) {
    const free = availableForRecording(this.dir, this.cfg.storage.maxDiskBytes);
    if (free < 1024 ** 3) {
      enforceDiskLimit(this.dir, this.cfg.storage.maxDiskBytes - 2 * 1024 ** 3, this.queue.uploadedFiles());
      if (availableForRecording(this.dir, this.cfg.storage.maxDiskBytes) < 1024 ** 3) {
        this.setState("error", "Espace disque réservé insuffisant : partie non enregistrée. Augmentez la limite ou attendez la fin des envois.");
        return;
      }
    }
    const startedAt = new Date().toISOString();
    const file = path.join(this.dir, `partie-${startedAt.replace(/[:.]/g, "-")}.mp4`);
    const backend = this.backend as "gdigrab" | "testsrc";
    const handle = startRecording(backend, this.cfg.capture, file, { maxBytes: availableForRecording(this.dir, this.cfg.storage.maxDiskBytes) });
    this.current = { file, startedAt, gameTimeAtStartSec: gameTimeSec, handle };
    writeFileSync(this.markerPath, JSON.stringify({ file, startedAt, gameTimeAtStartSec: gameTimeSec }));
    this.setState("recording", `Enregistrement en cours (fenêtre du jeu uniquement, sans micro ni webcam).`);
    this.log(`partie détectée (horloge ${gameTimeSec.toFixed(1)} s) → ${path.basename(file)}`);
  }

  private async onGameEnd() {
    const cur = this.current;
    if (!cur?.handle) return;
    this.current = null;
    this.setState("processing", "Partie terminée : finalisation de la vidéo.");
    let size = 0;
    try {
      size = (await cur.handle.stop()).sizeBytes;
    } catch (e) {
      this.setState("error", e instanceof Error ? e.message : "Arrêt de l'enregistrement échoué.");
      rmSync(this.markerPath, { force: true });
      return;
    }
    rmSync(this.markerPath, { force: true });
    const offset = offsetFromGameTime(cur.gameTimeAtStartSec); // temps vidéo à 00:00 en jeu
    const events = this.watcher.lastEvents;
    const player = this.watcher.activePlayer;
    const title = `Partie du ${new Date(cur.startedAt).toLocaleString("fr-FR")}`;

    if (this.cfg.upload.mode === "clips") {
      const durationMs = Date.now() - new Date(cur.startedAt).getTime();
      const windows = clipWindows(relevantEvents(events, player), {
        gameStartOffsetMs: offset,
        durationMs,
        beforeMs: this.cfg.upload.clipBeforeSec * 1000,
        afterMs: this.cfg.upload.clipAfterSec * 1000,
      });
      if (windows.length === 0) this.log("aucun événement du joueur : partie entière conservée");
      let n = 0;
      for (const w of windows) {
        const out = cur.file.replace(/\.mp4$/, `-clip${++n}.mp4`);
        try {
          await cutClip(cur.file, out, w);
          this.queue.add({
            id: randomUUID(),
            file: out,
            title: `${title} — ${w.reasons.join(", ")} (${n}/${windows.length})`,
            sizeBytes: statSync(out).size,
            capturedAt: cur.startedAt,
            gameStartOffsetMs: offset - w.startMs,
            activePlayer: player,
            events,
          });
        } catch (e) {
          this.log(`découpage ${n} échoué : ${e instanceof Error ? e.message : e}`);
        }
      }
      if (windows.length > 0 && n > 0) {
        rmSync(cur.file, { force: true }); // l'original n'est pas conservé en mode séquences
        this.setState("idle", `${windows.length} séquence(s) prête(s) à l'envoi.`);
        return;
      }
    }
    this.queue.add({ id: randomUUID(), file: cur.file, title, sizeBytes: size, capturedAt: cur.startedAt, gameStartOffsetMs: offset, activePlayer: player, events });
    this.setState("idle", "Vidéo prête à l'envoi.");
  }

  /** Envoie les éléments en attente (un à la fois). */
  async processQueue() {
    if (this.busy || !this.cfg.deviceToken || !this.cfg.upload.autoUpload) return;
    const next = this.queue.pending()[0];
    if (!next) return;
    this.busy = true;
    const prev = this.state;
    if (prev !== "recording") this.setState("uploading", `Envoi : ${next.title}`);
    try {
      const ok = await this.queue.upload(this.api, next, {
        deleteAfterUpload: this.cfg.storage.deleteAfterUpload,
        onProgress: (s, t) => {
          if (this.state === "uploading") this.message = `Envoi : ${next.title} — ${Math.floor((s / t) * 100)} %`;
        },
      });
      this.log(ok ? `envoyé : ${next.title}` : `envoi reporté : ${next.lastError}`);
    } finally {
      this.busy = false;
      if (this.state === "uploading") this.setState("idle", next.status === "done" ? "Envoi terminé." : `Envoi reporté : ${next.lastError}`);
      enforceDiskLimit(this.dir, this.cfg.storage.maxDiskBytes, this.queue.uploadedFiles());
    }
  }

  async heartbeat() {
    if (!this.cfg.deviceToken) return;
    await this.api.heartbeat(this.status()).catch(() => {});
  }

  start() {
    this.recoverInterrupted();
    this.queue.prune();
    const safe = (fn: () => Promise<void>) => () => void fn().catch((e) => this.log(`erreur : ${e instanceof Error ? e.message : e}`));
    this.timers.push(setInterval(safe(() => this.tick()), this.cfg.liveClient.pollMs));
    this.timers.push(setInterval(safe(() => this.processQueue()), 5000));
    this.timers.push(setInterval(safe(() => this.heartbeat()), 30_000));
    void safe(() => this.tick())();
    void safe(() => this.heartbeat())();
  }

  async stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (this.current) await this.onGameEnd();
  }

  private setState(s: AgentState, msg: string) {
    this.state = s;
    this.message = msg;
  }
}
