// Vérification GRATUITE de l'analyse IA : clé valide, tokens d'un vrai moment, coût estimé, budget.
// Utilise uniquement le comptage de tokens d'Anthropic (gratuit) : aucune analyse n'est facturée.
//   npm run ai:check                 → image de test générée
//   npm run ai:check -- partie.mp4   → 6 images extraites de ta vidéo (comme l'analyse réelle)
import "./load-env"; // en premier : .env chargé avant les autres modules
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { MOMENT_SYSTEM, aiBudgetMicros, aiMaxMoments, aiModel, aiSpentThisMonthMicros, grabFrame, momentContent, sampleTimes } from "../src/server/analysis/ai";

const PRICE = { in: 4, out: 20 }; // claude-opus-5-5, $ par million de tokens
const usd = (micros: number) => `${(micros / 1e6).toFixed(3)} $`;

/** Diagnostic du fichier .env (sans jamais afficher la clé) et lecture tolérante de ANTHROPIC_API_KEY. */
function loadKey(): string | null {
  const here = process.cwd();
  console.log(`Dossier : ${here}`);
  if (!existsSync(".env")) {
    console.log(existsSync(".env.txt") ? "❌ Le fichier s'appelle « .env.txt » : renomme-le en « .env » (sans .txt)." : "❌ Aucun fichier .env dans ce dossier (lance la commande depuis le dossier coachgg).");
    return process.env.ANTHROPIC_API_KEY?.trim() || null;
  }
  let raw = readFileSync(".env", "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // BOM ajouté par certains éditeurs Windows
  const lines = raw.split(/\r?\n/).filter((l) => /^\s*(export\s+)?ANTHROPIC_API_KEY\s*=/.test(l));
  if (!lines.length) {
    console.log("❌ Le fichier .env ne contient pas de ligne ANTHROPIC_API_KEY=...");
    return process.env.ANTHROPIC_API_KEY?.trim() || null;
  }
  if (lines.length > 1) console.log(`⚠️  ${lines.length} lignes ANTHROPIC_API_KEY dans .env : garde-n'en qu'une (la dernière est utilisée).`);
  const value = lines.at(-1)!.replace(/^[^=]*=/, "").trim().replace(/^["']|["']$/g, "").trim();
  if (!value) {
    console.log("❌ La ligne ANTHROPIC_API_KEY est vide : colle ta clé entre les guillemets.");
    return null;
  }
  console.log(`Clé trouvée dans .env : ${value.slice(0, 10)}… (${value.length} caractères)`);
  if (/\s/.test(value)) console.log("⚠️  La clé contient un espace ou un retour à la ligne : recolle-la d'un seul bloc.");
  process.env.ANTHROPIC_API_KEY = value; // la valeur du fichier fait foi
  return value;
}

async function main() {
  if (!loadKey()) process.exit(1);
  const video = process.argv[2];
  const tmp = await mkdtemp(path.join(os.tmpdir(), "coachgg-aicheck-"));
  try {
    const times = sampleTimes(20_000, 30_000);
    const images: Buffer[] = [];
    for (const [i, t] of times.entries()) {
      const f = path.join(tmp, `f${i}.jpg`);
      if (video) await grabFrame(process.env.FFMPEG_BIN || "ffmpeg", video, Math.min(t, 25_000), f);
      else execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080", "-frames:v", "1", "-vf", "scale=768:-2", f]);
      images.push(await readFile(f));
    }
    const client = new Anthropic();
    let input: number;
    try {
      const r = await client.messages.countTokens({
        model: aiModel(),
        system: MOMENT_SYSTEM(),
        messages: [{ role: "user", content: momentContent(images, times, { deathMs: 30_000, gameStartOffsetMs: null, ruleObservations: ["(exemple)"] }) as Anthropic.ContentBlockParam[] }],
      });
      input = r.input_tokens + 700; // + schéma de sortie structurée (estimation)
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) console.log("❌ Clé refusée par Anthropic (invalide ou révoquée).");
      else if (e instanceof Anthropic.PermissionDeniedError) console.log("❌ Clé valide mais sans accès à ce modèle.");
      else if (e instanceof Anthropic.APIError) console.log(`❌ Erreur Anthropic ${e.status} : ${e.message}`);
      else console.log("❌ Anthropic injoignable (réseau).");
      process.exit(1);
    }
    console.log(`✅ Clé valide · modèle ${aiModel()}`);
    const low = Math.round(input * PRICE.in + 1200 * PRICE.out);
    const high = Math.round(input * PRICE.in + 3500 * PRICE.out);
    console.log(`Par mort analysée : ${input} tokens envoyés (6 images) → coût estimé ${usd(low)} à ${usd(high)}`);
    const perVideo = aiMaxMoments();
    console.log(`Par vidéo (${perVideo} mort(s) max + bilan) : jusqu'à ~${usd(high * perVideo + 80_000)}`);
    const budget = aiBudgetMicros();
    try {
      const spent = await aiSpentThisMonthMicros();
      if (budget) console.log(`Budget du mois : ${usd(budget)} · déjà dépensé : ${usd(spent)} · reste ≈ ${Math.max(0, Math.floor((budget - spent) / high))} mort(s) analysable(s)`);
      else console.log(`⚠️  Pas de plafond : ajoute ANALYSIS_AI_BUDGET_USD dans .env (ex. 1.5). Déjà dépensé ce mois : ${usd(spent)}`);
    } catch {
      console.log("(Base de données non joignable : budget non calculé.)");
    }
    console.log("Aucune analyse n'a été facturée : le comptage de tokens est gratuit.");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0));
