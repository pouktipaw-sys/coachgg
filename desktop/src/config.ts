// Configuration de l'agent CoachGG (stockée localement, jamais envoyée au serveur).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const AGENT_VERSION = "0.1.0";

export function appHome(): string {
  if (process.env.COACHGG_HOME) return process.env.COACHGG_HOME;
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "CoachGG");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "CoachGG");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "coachgg");
}

export const configSchema = z.object({
  serverUrl: z.string().url().default("http://localhost:3000"),
  deviceToken: z.string().nullable().default(null),
  deviceName: z.string().default(os.hostname()),
  capture: z
    .object({
      // gdigrab : capture de la SEULE fenêtre du jeu (Windows). testsrc : source de test.
      backend: z.enum(["auto", "gdigrab", "testsrc", "none"]).default("auto"),
      windowTitle: z.string().default("League of Legends (TM) Client"),
      fps: z.number().int().min(10).max(60).default(30),
      maxHeight: z.number().int().min(360).max(2160).default(1080),
      encoder: z.enum(["libx264", "h264_nvenc", "h264_amf", "h264_qsv"]).default("libx264"),
      quality: z.number().int().min(18).max(35).default(26),
      // Désactivés par défaut et non configurables dans cette version : aucune capture audio, micro ou webcam.
      audio: z.literal(false).default(false),
      microphone: z.literal(false).default(false),
      webcam: z.literal(false).default(false),
    })
    .prefault({}), // zod 4 : « prefault » applique les valeurs par défaut internes
  storage: z
    .object({
      dir: z.string().optional(),
      maxDiskBytes: z.number().int().min(1024 ** 3).default(20 * 1024 ** 3),
      deleteAfterUpload: z.boolean().default(true),
    })
    .prefault({}), // zod 4 : « prefault » applique les valeurs par défaut internes
  upload: z
    .object({
      // full : partie entière ; clips : uniquement les séquences autour des événements du joueur.
      mode: z.enum(["full", "clips"]).default("full"),
      clipBeforeSec: z.number().int().min(5).max(60).default(15),
      clipAfterSec: z.number().int().min(2).max(30).default(5),
      autoUpload: z.boolean().default(true),
    })
    .prefault({}), // zod 4 : « prefault » applique les valeurs par défaut internes
  liveClient: z
    .object({
      // API locale du client de jeu (lecture seule) : détection de partie et événements, utilisés APRÈS le match.
      url: z.string().default("https://127.0.0.1:2999"),
      pollMs: z.number().int().min(500).max(10_000).default(2000),
    })
    .prefault({}), // zod 4 : « prefault » applique les valeurs par défaut internes
});

export type AgentConfig = z.infer<typeof configSchema>;

export const configPath = (home = appHome()) => path.join(home, "config.json");
export const storageDir = (cfg: AgentConfig, home = appHome()) => cfg.storage.dir ?? path.join(home, "recordings");

export function loadConfig(home = appHome()): AgentConfig {
  const p = configPath(home);
  if (!existsSync(p)) return configSchema.parse({});
  return configSchema.parse(JSON.parse(readFileSync(p, "utf8")));
}

/** Écriture atomique (fichier temporaire puis renommage). */
export function saveConfig(cfg: AgentConfig, home = appHome()) {
  mkdirSync(home, { recursive: true });
  const p = configPath(home);
  writeFileSync(`${p}.tmp`, JSON.stringify(configSchema.parse(cfg), null, 2), { mode: 0o600 });
  renameSync(`${p}.tmp`, p);
}

export function resolveBackend(cfg: AgentConfig): "gdigrab" | "testsrc" | "none" {
  if (cfg.capture.backend !== "auto") return cfg.capture.backend;
  return process.platform === "win32" ? "gdigrab" : "none";
}
