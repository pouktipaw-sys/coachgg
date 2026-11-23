// Lancement automatique de l'agent à l'ouverture de session Windows (dossier « Démarrage » de l'utilisateur) :
// l'agent attend ensuite le client et les parties tout seul. Aucun droit administrateur, désactivable à tout moment.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export function startupDir(env: NodeJS.ProcessEnv = process.env) {
  if (!env.APPDATA) return null;
  return path.join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

export const AUTOSTART_FILE = "CoachGG Agent.cmd";

/** Script de démarrage : lance l'agent réduit, depuis le dossier du projet. */
export function autostartScript(projectDir: string) {
  return ["@echo off", `cd /d "${projectDir}"`, 'start "CoachGG Agent" /min cmd /c "npm run agent -- start"', ""].join("\r\n");
}

export function setAutostart(on: boolean, projectDir: string, dir = startupDir()) {
  if (!dir) throw new Error("Lancement automatique disponible sous Windows uniquement.");
  const file = path.join(dir, AUTOSTART_FILE);
  if (on) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, autostartScript(projectDir));
  } else rmSync(file, { force: true });
  return { file, enabled: on && existsSync(file) };
}
