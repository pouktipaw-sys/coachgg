#!/usr/bin/env node
// Agent PC CoachGG — ligne de commande.
//   coachgg-agent start            lance l'agent + l'interface locale
//   coachgg-agent pair <CODE> [--server URL] [--name NOM]
//   coachgg-agent test             test d'enregistrement de 4 s
//   coachgg-agent status           état local et file d'envoi
import os from "node:os";
import { Agent } from "./agent";
import { CoachApi } from "./api";
import { AGENT_VERSION, appHome, configSchema, loadConfig, saveConfig } from "./config";
import { ffmpegAvailable, testRecording } from "./diagnostics";
import { startLocalUi } from "./localui";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const cmd = process.argv[2] ?? "start";
  const cfg = loadConfig();
  if (cmd === "pair") {
    const code = process.argv[3];
    if (!code) throw new Error("Usage : coachgg-agent pair <CODE> [--server URL] [--name NOM]");
    const server = arg("--server") ?? cfg.serverUrl;
    const name = arg("--name") ?? cfg.deviceName ?? os.hostname();
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
    const r = await new CoachApi(server, null).pair(code, name, platform, AGENT_VERSION);
    saveConfig(configSchema.parse({ ...cfg, serverUrl: server, deviceName: name, deviceToken: r.token }));
    console.log(`PC appairé : « ${r.device.name} ». Configuration : ${appHome()}`);
    return;
  }
  if (cmd === "test") {
    const r = await testRecording(cfg);
    console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (cmd === "status") {
    const a = new Agent(cfg);
    console.log(JSON.stringify({ ...a.status(), paired: !!cfg.deviceToken, home: appHome(), ffmpeg: ffmpegAvailable() }, null, 2));
    return;
  }
  if (cmd === "start") {
    if (!ffmpegAvailable()) console.warn("⚠ FFmpeg introuvable : l'enregistrement est impossible.");
    if (!cfg.deviceToken) console.warn("⚠ PC non appairé : les vidéos seront conservées localement jusqu'à l'appairage.");
    const agent = new Agent(cfg);
    agent.start();
    const ui = startLocalUi(agent);
    console.log(`CoachGG agent v${AGENT_VERSION} démarré. Interface locale : ${ui.url}`);
    const stop = async () => {
      console.log("Arrêt : finalisation de l'enregistrement en cours…");
      await agent.stop();
      ui.server.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }
  throw new Error(`Commande inconnue : ${cmd}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
