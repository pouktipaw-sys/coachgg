// Chargement tolérant du fichier .env (scripts, worker) : ignore la marque BOM et les fins de ligne
// Windows, retire les guillemets, n'écrase jamais une variable déjà définie (sauf vide).
import { existsSync, readFileSync } from "node:fs";

export function loadEnv(file = ".env") {
  if (!existsSync(file)) return false;
  let raw = readFileSync(file, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, ""); // commentaire en fin de ligne (valeur sans guillemets)
    const cur = process.env[m[1]!];
    if (cur === undefined || cur === "") process.env[m[1]!] = v;
  }
  return true;
}
