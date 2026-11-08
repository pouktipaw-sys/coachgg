// Parcours réel : inscription → import d'une vraie vidéo → traitement FFmpeg →
// moment de coaching → annotation → lecture synchronisée (ralenti, pause, seek,
// redimensionnement, plein écran) → persistance.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIX = path.resolve(__dirname, "../fixtures/generated");
const SAMPLE = path.join(FIX, "sample.mp4");

test.beforeAll(() => {
  mkdirSync(FIX, { recursive: true });
  if (!existsSync(SAMPLE))
    execSync("ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 -t 20 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest sample.mp4", { cwd: FIX });
});

const uid = () => Math.random().toString(36).slice(2, 8);

async function register(page: Page, name: string) {
  const email = `${name.toLowerCase()}-${uid()}@e2e.dev`;
  await page.goto("/register");
  await page.fill("#displayName", name);
  await page.fill("#email", email);
  await page.fill("#password", "motdepasse-e2e");
  await page.click("button:has-text('Créer un compte')");
  await page.waitForURL("**/app/onboarding");
  return email;
}

async function videoTime(page: Page) {
  return page.locator("[data-testid=video]").evaluate((v: HTMLVideoElement) => v.currentTime);
}

async function seekTo(page: Page, sec: number) {
  await page.locator("[data-testid=video]").evaluate((v: HTMLVideoElement, s) => {
    v.pause();
    v.currentTime = s;
  }, sec);
  await page.waitForFunction((s) => Math.abs((document.querySelector("video") as HTMLVideoElement).currentTime - s) < 0.05 && !(document.querySelector("video") as HTMLVideoElement).seeking, sec);
}

test("import vidéo réel, moment de coaching annoté et lecture synchronisée", async ({ page }) => {
  await register(page, "Alice");

  // Import
  await page.goto("/app/videos/upload");
  await page.setInputFiles("[data-testid=file-input]", SAMPLE);
  await page.click("button:has-text('Envoyer la vidéo')");
  await expect(page.getByText("Vidéo prête")).toBeVisible({ timeout: 60_000 });
  await page.click("text=Ouvrir le lecteur de coaching");
  await page.waitForSelector("[data-testid=coaching-studio]");
  await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 1);
  const recordingUrl = page.url();

  // Création d'un moment à 7 s
  await seekTo(page, 7);
  await page.click("role=tab[name='+ Moment']");
  await page.getByRole("button", { name: "← maintenant" }).nth(2).click(); // décision = maintenant
  await page.fill("#m-title", "Avancée sans vision");
  await page.fill("#m-obs", "Aucun ennemi visible sur la minimap\nAllié jungle visible en haut");
  await page.fill("#m-int", "Risque d'embuscade sans information.");
  await page.getByLabel("Alternative 1").fill("Rester derrière la vague");
  await page.fill("#m-confr", "Position adverse inconnue");
  await page.fill("#m-adv", "Sans vision, reste derrière ta vague.");
  await page.click("button:has-text('Enregistrer le moment')");
  await expect(page.locator("[data-testid=moment-card]")).toContainText("Avancée sans vision");

  // Annotation : trajectoire alternative liée au moment, posée à 5 s, durée 4 s
  await seekTo(page, 5);
  await page.click("role=tab[name='Annoter']");
  await page.selectOption("#a-type", "path");
  await page.selectOption("#a-style", "alternative");
  const momentOption = await page.locator("#a-rec option").nth(1).getAttribute("value");
  await page.selectOption("#a-rec", momentOption!);
  const stage = page.locator("[data-testid=video-stage]");
  const box = (await stage.boundingBox())!;
  await stage.click({ position: { x: box.width * 0.3, y: box.height * 0.6 } });
  await stage.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } });
  await stage.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
  await page.click("button:has-text(\"Enregistrer l'annotation\")");
  await expect(page.getByText("Annotations (1)")).toBeVisible();

  // Annotation visible à 6 s, invisible à 2 s (après seek)
  await seekTo(page, 6);
  await expect(page.locator("[data-annotation-type=path]")).toHaveCount(1);
  await seekTo(page, 2);
  await expect(page.locator("[data-annotation-type=path]")).toHaveCount(0);

  // Lecture depuis 4 s : ralenti puis pause automatique à la décision (7 s)
  await page.click("role=tab[name=/Moments/]");
  await seekTo(page, 4);
  await page.click("[data-testid=play-toggle]");
  await expect(page.locator("[data-testid=coaching-phase]")).toContainText("Ralenti", { timeout: 5000 });
  const rate = await page.locator("[data-testid=video]").evaluate((v: HTMLVideoElement) => v.playbackRate);
  expect(rate).toBe(0.5);
  await expect(page.locator("[data-testid=coaching-phase]")).toContainText("Moment de décision", { timeout: 15_000 });
  expect(await page.locator("[data-testid=video]").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(Math.abs((await videoTime(page)) - 7)).toBeLessThan(0.1);
  await expect(page.locator("[data-testid=moment-card]")).toContainText("Rester derrière la vague");
  await expect(page.locator("[data-testid=manual-badge]")).toBeVisible();

  // Redimensionnement : l'annotation reste ancrée à la même position relative de l'image
  const rel = async () => {
    const s = (await stage.boundingBox())!;
    const g = (await page.locator("[data-annotation-type=path] circle").first().boundingBox())!;
    return { x: (g.x + g.width / 2 - s.x) / s.width, y: (g.y + g.height / 2 - s.y) / s.height };
  };
  const before = await rel();
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(300);
  const after = await rel();
  expect(Math.abs(before.x - after.x)).toBeLessThan(0.02);
  expect(Math.abs(before.y - after.y)).toBeLessThan(0.02);
  expect(before.x).toBeCloseTo(0.3, 1);

  // Plein écran (avec letterbox) : position toujours correcte relativement à l'image
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click("button[aria-label='Plein écran']");
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.waitForTimeout(300);
  const fsStage = (await stage.boundingBox())!;
  const dot = (await page.locator("[data-annotation-type=path] circle").first().boundingBox())!;
  const videoW = Math.min(fsStage.width, fsStage.height * (16 / 9));
  const offsetX = (fsStage.width - videoW) / 2;
  expect(((dot.x + dot.width / 2 - fsStage.x - offsetX) / videoW)).toBeCloseTo(0.3, 1);
  await page.keyboard.press("Escape");

  // Persistance après rechargement
  await page.goto(recordingUrl);
  await page.waitForSelector("[data-testid=coaching-studio]");
  await expect(page.getByText("Moments (1)")).toBeVisible();
});

test("fichier invalide refusé avec un message clair", async ({ page }) => {
  await register(page, "Bob");
  await page.goto("/app/videos/upload");
  await page.setInputFiles("[data-testid=file-input]", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator("p[role=alert]")).toContainText("Format non pris en charge");
  await page.setInputFiles("[data-testid=file-input]", { name: "faux.mp4", mimeType: "video/mp4", buffer: Buffer.from("<html>".padEnd(5000, "x")) });
  await page.click("button:has-text('Envoyer la vidéo')");
  await expect(page.locator("p[role=alert]")).toContainText("ne correspond pas", { timeout: 10_000 });
});

test("groupe d'amis : invitation, match commun et MVP", async ({ page, browser }) => {
  // Bob s'inscrit dans un autre contexte et déclare son Riot ID
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  const bobEmail = await register(bob, "Bob");
  await bob.fill("#i-id", "BobGG#EUW");
  await bob.click("button:has-text('Associer')");
  await expect(bob.getByText("Associé : BobGG#EUW").or(bob.getByText("Identité ajoutée"))).toBeVisible();

  // Alice crée le groupe et invite Bob
  await register(page, "Alice");
  await page.fill("#i-id", "AliceGG#EUW");
  await page.click("button:has-text('Associer')");
  await page.goto("/app/teams");
  await page.fill("#t-name", "Duo du soir");
  await page.click("button:has-text('Créer')");
  await page.waitForURL(/\/app\/teams\/.+/);
  await page.fill("input[name=email]", bobEmail);
  await page.click("button:has-text('Inviter')");
  await expect(page.getByText("Si un compte CoachGG correspond")).toBeVisible();

  // Bob accepte
  await bob.goto("/app/invitations");
  await bob.click("button:has-text('Accepter')");
  await bob.waitForURL(/\/app\/teams\/.+/);

  // Alice saisit une partie avec Bob
  await page.goto("/app/matches/new");
  await page.fill("#mm-dur", "30:00");
  const row = (i: number) => page.locator("tbody tr").nth(i);
  await row(0).getByLabel("Champion", { exact: true }).fill("Ahri");
  await row(0).getByLabel("Rôle", { exact: true }).selectOption("MIDDLE");
  for (const [k, v] of Object.entries({ "Éliminations": "9", Morts: "2", Assistances: "8", CS: "240", "Dégâts aux champions": "26000", "Dégâts aux objectifs": "6000", "Score de vision": "28" }))
    await row(0).getByLabel(k, { exact: true }).fill(v);
  await page.click("button:has-text('+ Ajouter un joueur')");
  await row(1).getByLabel("Riot ID", { exact: true }).fill("BobGG");
  await row(1).getByLabel("Tag", { exact: true }).fill("EUW");
  await row(1).getByLabel("Champion", { exact: true }).fill("Vi");
  await row(1).getByLabel("Rôle", { exact: true }).selectOption("JUNGLE");
  for (const [k, v] of Object.entries({ "Éliminations": "3", Morts: "7", Assistances: "6", CS: "120", "Dégâts aux champions": "12000", "Dégâts aux objectifs": "4000", "Score de vision": "12" }))
    await row(1).getByLabel(k, { exact: true }).fill(v);
  await page.getByLabel("Éliminations de l'équipe").fill("25");
  await page.getByLabel("Dégâts aux champions de l'équipe").fill("90000");
  await page.getByLabel("Dégâts aux objectifs de l'équipe").fill("30000");
  await page.click("button:has-text('Enregistrer le match')");
  await page.waitForURL(/\/app\/matches\/.+/);
  await expect(page.locator("[data-testid=match-score]")).not.toHaveText("—");
  await expect(page.getByText("Entre amis")).toBeVisible();

  // Bob voit le MVP du groupe
  await bob.goto("/app/teams");
  await bob.click("text=Duo du soir");
  await expect(bob.locator("[data-testid=mvp-explanation]")).toContainText("Alice");
  await bobCtx.close();
});

test("analyse assistée : proposition automatique en brouillon, revue et validation", async ({ page }) => {
  const ANALYSIS = path.join(FIX, "analysis.mp4");
  if (!existsSync(ANALYSIS))
    execSync(
      "ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 30 -vf \"drawbox=x=1000:y=480:w=240:h=240:color=0x202830:t=fill,drawbox=x=1150:y=500:w=30:h=30:color=red:t=fill:enable='between(t,6,13)',hue=s=0:enable='between(t,13,20)'\" -c:v libx264 -pix_fmt yuv420p analysis.mp4",
      { cwd: FIX },
    );
  await register(page, "Chloe");
  await page.goto("/app/videos/upload");
  await page.setInputFiles("[data-testid=file-input]", ANALYSIS);
  await page.click("button:has-text('Envoyer la vidéo')");
  await expect(page.getByText("Vidéo prête")).toBeVisible({ timeout: 60_000 });
  await page.click("text=Ouvrir le lecteur de coaching");
  await page.waitForSelector("[data-testid=analysis-panel]");
  // L'analyse est lancée automatiquement après le traitement.
  await expect(page.locator("[data-testid=analysis-status]")).toContainText("validation nécessaire", { timeout: 60_000 });
  await expect(page.getByText("Contient des propositions automatiques")).toBeVisible();
  await page.getByRole("button", { name: /^0:1\d Écran grisé/ }).click();
  await expect(page.locator("[data-testid=auto-badge]")).toContainText("à valider");
  await expect(page.getByAltText(/Planche de 8 images/)).toBeVisible();
  await expect(page.locator("[data-testid=moment-card]")).toContainText("pas forcément une erreur");
  await page.locator("[data-testid=review-box]").getByRole("button", { name: "Valider" }).click();
  await expect(page.locator("[data-testid=auto-badge]")).toContainText("validée");

  // Mesure de la précision : marquer la mort réelle à 0:13 puis lire le résultat.
  await expect(page.locator("[data-testid=evaluation-result]")).toContainText("Aucune vérité terrain");
  await seekTo(page, 13);
  await page.click("[data-testid=mark-death]");
  await expect(page.locator("[data-testid=truth-list]")).toContainText("0:13");
  await expect(page.locator("[data-testid=evaluation-result]")).toContainText("Précision");
  await expect(page.locator("[data-testid=evaluation-result]")).toContainText("1 correcte(s) · 0 fausse(s) alerte(s) · 0 mort(s) manquée(s)");
});

test("application PC : appairage, enregistrement d'une partie simulée, envoi automatique", async ({ page }) => {
  const { Agent } = await import("../../desktop/src/agent");
  const { CoachApi } = await import("../../desktop/src/api");
  const { configSchema } = await import("../../desktop/src/config");
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");

  await register(page, "Dana");
  await page.goto("/app/capture");
  await page.click("[data-testid=pairing-generate]");
  const code = (await page.locator("[data-testid=pairing-code]").textContent())!.trim();

  const pair = await new CoachApi("http://localhost:3100", null).pair(code, "PC de test", "linux", "0.1.0");
  const cfg = configSchema.parse({ serverUrl: "http://localhost:3100", deviceToken: pair.token, capture: { backend: "testsrc", fps: 15, maxHeight: 360 } });
  // Partie simulée : début à 10 s de jeu, mort du joueur à 11,5 s, fin quand le client disparaît.
  let i = 0;
  const times = [10, 11, 12, null, null, null];
  const probe = {
    gameTime: async () => times[Math.min(i++, times.length - 1)] ?? null,
    events: async () => [{ name: "ChampionKill", gameTimeMs: 11_500, killer: "Ennemi", victim: "Dana" }],
    activePlayer: async () => "Dana#EUW",
  };
  const agent = new Agent(cfg, { home: mkdtempSync(path.join(os.tmpdir(), "cgg-e2e-agent-")), probe, log: () => {} });
  await agent.tick(); // début de partie → enregistrement
  expect(agent.state).toBe("recording");
  await agent.heartbeat();
  await page.reload();
  await expect(page.locator("[data-testid=device-list]")).toContainText("Enregistrement en cours");
  await new Promise((r) => setTimeout(r, 3000));
  for (let k = 0; k < 5; k++) await agent.tick(); // fin de partie détectée
  await agent.processQueue();
  expect(agent.queue.items[0]!.status).toBe("done");

  await page.reload();
  await expect(page.getByText("Dernières parties enregistrées")).toBeVisible();
  await page.locator("section", { hasText: "Dernières parties enregistrées" }).getByRole("link").first().click();
  await expect(page.locator("[data-testid=coaching-studio]")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-testid=time-display]")).toContainText("jeu"); // synchronisée automatiquement
  await expect(page.locator("[data-testid=truth-list]")).toContainText("application PC");
});
