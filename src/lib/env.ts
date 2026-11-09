// Configuration centralisée (côté serveur uniquement).
function int(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Variable ${name} invalide : ${raw}`);
  return n;
}

export const env = {
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get storageDir() {
    return process.env.STORAGE_DIR ?? "./storage";
  },
  get maxUploadBytes() {
    return int("MAX_UPLOAD_BYTES", 4 * 1024 ** 3);
  },
  get userQuotaBytes() {
    return int("USER_STORAGE_QUOTA_BYTES", 20 * 1024 ** 3);
  },
  get maxVideoDurationSec() {
    return int("MAX_VIDEO_DURATION_SEC", 3 * 3600);
  },
  get chunkBytes() {
    return int("UPLOAD_CHUNK_BYTES", 8 * 1024 ** 2);
  },
  get ffmpegThreads() {
    return int("FFMPEG_THREADS", 2);
  },
  get ffmpegTimeoutSec() {
    return int("FFMPEG_TIMEOUT_SEC", 3600);
  },
  /** Interpréteur Python de l'analyse vidéo (venv recommandé : .venv-analysis). */
  get pythonBin() {
    return process.env.ANALYSIS_PYTHON ?? ".venv-analysis/bin/python";
  },
  get analysisTimeoutSec() {
    return int("ANALYSIS_TIMEOUT_SEC", 1800);
  },
  get riotApiKey() {
    return process.env.RIOT_API_KEY?.trim() || null;
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
};

/** État des intégrations, affiché honnêtement dans l'interface. */
export function integrationStatus() {
  return {
    riotApi: env.riotApiKey ? "configured" : "not_configured",
    riotSignOn: "not_configured", // RSO : nécessite une application Riot approuvée
    mailer: "console_dev_only",
    desktopCapture: "not_available",
    automaticVideoAnalysis: "experimental", // nécessite Python + OpenCV côté worker
    objectStorage: "local_disk",
    coachLlm: process.env.ANTHROPIC_API_KEY ? "configured" : "not_configured",
  } as const;
}
