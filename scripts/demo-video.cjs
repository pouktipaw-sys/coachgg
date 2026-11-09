// Enregistre une vidéo de démonstration de CoachGG (Playwright).
//   node scripts/demo-video.cjs <url-du-serveur> <video-de-partie.mp4> <dossier-de-sortie>
// Le serveur et le worker doivent tourner. Les données sont créées pour un compte neuf.
const { chromium } = require("playwright");
const path = require("node:path");

const BASE = process.argv[2] ?? "http://localhost:3100";
const GAME = path.resolve(process.argv[3] ?? "partie-demo.mp4");
const OUT = path.resolve(process.argv[4] ?? "demo-out");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Navigation + attente de l'hydratation React (sinon les actions sont perdues). */
async function go(page, url) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

async function caption(page, text, sub = "") {
  await page.evaluate(
    ([t, s]) => {
      let el = document.getElementById("__demo_caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "__demo_caption";
        Object.assign(el.style, {
          position: "fixed", left: "50%", bottom: "18px", transform: "translateX(-50%)", zIndex: "99999",
          background: "rgba(10,13,20,0.92)", color: "#fff", border: "1px solid #4c9dff", borderRadius: "12px",
          padding: "10px 18px", font: "600 17px system-ui, sans-serif", maxWidth: "88%", textAlign: "center",
          boxShadow: "0 6px 24px rgba(0,0,0,.5)", pointerEvents: "none",
        });
        document.body.appendChild(el);
      }
      el.innerHTML = t + (s ? `<div style="font-weight:400;font-size:13px;color:#aab3c5;margin-top:3px">${s}</div>` : "");
    },
    [text, sub],
  );
}

async function smoothScroll(page, selector, to, steps = 25) {
  await page.evaluate(
    async ([sel, target, n]) => {
      const el = sel ? document.querySelector(sel) : document.scrollingElement;
      const from = el.scrollTop;
      const dest = target === "bottom" ? el.scrollHeight : target;
      for (let i = 1; i <= n; i++) {
        el.scrollTop = from + ((dest - from) * i) / n;
        await new Promise((r) => setTimeout(r, 40));
      }
    },
    [selector, to, steps],
  );
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  const email = `demo-${Date.now()}@coachgg.demo`;

  // 1 · Présentation
  await go(page, BASE);
  await caption(page, "CoachGG — coaching League of Legends après match", "Démonstration · partie simulée (aucune image du jeu)");
  await wait(3500);
  await smoothScroll(page, null, 700, 30);
  await wait(1500);

  // 2 · Compte
  await go(page, `${BASE}/register`);
  await caption(page, "Création d'un compte CoachGG", "Le mot de passe Riot n'est jamais demandé");
  await page.fill("#displayName", "Alex", { timeout: 10000 });
  await page.type("#email", email, { delay: 15 });
  await page.type("#password", "motdepasse-demo", { delay: 15 });
  await wait(600);
  await page.click("button:has-text('Créer un compte')");
  await page.waitForURL("**/app/onboarding");

  // 3 · Import d'une vraie vidéo
  await go(page, `${BASE}/app/videos/upload`);
  await caption(page, "1 · Import de la vidéo de la partie", "Envoi par morceaux, reprise automatique après coupure");
  await page.setInputFiles("[data-testid=file-input]", GAME);
  await page.fill("#rec-title", "Partie du soir — mid");
  await wait(1200);
  await page.click("button:has-text('Envoyer la vidéo')");
  await caption(page, "1 · Import de la vidéo de la partie", "Vérification du fichier, conversion et miniature par le serveur (FFmpeg)");
  await page.getByText("Vidéo prête").waitFor({ timeout: 90000 });
  await wait(1500);
  const recId = (await page.getByRole("link", { name: /Ouvrir le lecteur/ }).getAttribute("href")).split("/").pop();

  // Données du coaching (préparées ici via l'API pour la démo ; l'éditeur permet de les créer à la main)
  await page.request.patch(`${BASE}/api/recordings/${recId}`, {
    data: { gameStartOffsetMs: -750000, minimapRegion: { x: 0.8125, y: 0.6667, w: 0.1875, h: 0.3333 } },
  });
  const rec = await (
    await page.request.post(`${BASE}/api/recordings/${recId}/recommendations`, {
      data: {
        kind: "MISTAKE", category: "POSITIONING", title: "Avancée vers la rivière sans soutien",
        contextStartMs: 3000, slowdownStartMs: 8000, decisionMs: 11000, endMs: 15000, slowdownRate: 0.5,
        observations: [
          "Deux ennemis apparaissent sur la minimap à 0:06 (12:36 de jeu).",
          "Aucun allié visible à proximité.",
          "Le joueur continue d'avancer vers la rivière après leur apparition.",
        ],
        interpretation: "Avec deux ennemis visibles et aucun allié proche, continuer d'avancer expose à un engagement à deux contre un, avec les informations disponibles à ce moment-là.",
        alternatives: [{ label: "Reculer vers la base alliée en restant hors de portée", conditions: "si les deux ennemis restent visibles et qu'aucun allié n'approche", limits: "perte de pression sur la rivière ; issue non garantie" }],
        confidence: "MEDIUM", confidenceReason: "Ennemis visibles avant la décision ; intentions des alliés inconnues",
        advice: "Quand deux ennemis apparaissent sur la minimap, recule avant d'avancer.",
      },
    })
  ).json();
  const momentId = rec.recommendation.id;
  const ann = (a) => page.request.post(`${BASE}/api/recordings/${recId}/annotations`, { data: { ...a, recommendationId: momentId } });
  await ann({ type: "path", style: "actual", startMs: 3000, endMs: 12500, geometry: { points: [{ x: 0.222, y: 0.593 }, { x: 0.29, y: 0.554 }, { x: 0.359, y: 0.511 }] } });
  await ann({ type: "path", style: "alternative", startMs: 8500, endMs: 13000, geometry: { points: [{ x: 0.29, y: 0.554 }, { x: 0.2, y: 0.65 }, { x: 0.11, y: 0.76 }] } });
  await ann({ type: "zone", style: "danger", startMs: 6000, endMs: 13000, geometry: { center: { x: 0.6, y: 0.37 }, r: 0.09 } });
  await ann({ type: "highlight", style: "enemy", startMs: 6500, endMs: 13000, geometry: { at: { x: 0.599, y: 0.371 }, r: 0.03 } });
  await ann({ type: "click", style: "alternative", startMs: 10500, endMs: 13000, geometry: { at: { x: 0.11, y: 0.76 } } });
  await ann({ type: "highlight", style: "enemy", space: "MINIMAP", startMs: 6000, endMs: 13000, geometry: { at: { x: 0.6, y: 0.37 }, r: 0.12 }, label: "Ennemis visibles" });
  await page.request.post(`${BASE}/api/recordings/${recId}/analyze`, { data: { contextSec: 10 } });

  // 4 · Lecteur de coaching
  await go(page, `${BASE}/app/videos/${recId}`);
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
  await caption(page, "2 · Lecteur de coaching", "Moment annoté : contexte, ralenti, puis pause à la décision");
  await wait(2500);
  await page.locator("[data-testid=video]").evaluate((v) => { v.currentTime = 3; });
  await wait(500);
  await page.click("[data-testid=play-toggle]");
  await caption(page, "2 · Contexte avant l'action", "Trajet réel en rouge · zone dangereuse · ennemis visibles (image et minimap)");
  await page.locator("[data-testid=coaching-phase]").filter({ hasText: "Ralenti" }).waitFor({ timeout: 20000 });
  await caption(page, "2 · Ralenti ×0,5 à l'approche de la décision");
  await page.locator("[data-testid=coaching-phase]").filter({ hasText: "décision" }).waitFor({ timeout: 20000 });
  await caption(page, "3 · Pause : une autre décision était possible", "L'alternative proposée (verte) se dessine · clic conseillé, jamais observé");
  await wait(5000);

  // 5 · Explication
  await caption(page, "4 · Explication structurée", "Observations · interprétation · alternatives · confiance · conseil · références");
  await smoothScroll(page, "aside.card", "bottom", 60);
  await wait(2000);
  await page.click("button:has-text('Revoir la séquence')");
  await caption(page, "5 · Relecture de la séquence");
  await wait(5000);
  await page.click("[data-testid=play-toggle]").catch(() => {});

  // 6 · Analyse assistée
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForSelector("[data-testid=analysis-panel]");
  await caption(page, "6 · Analyse assistée (expérimentale)", "Mort probable détectée automatiquement → proposition à valider par le joueur");
  await page.locator("[data-testid=analysis-status]").filter({ hasText: /validation|Terminée/ }).waitFor({ timeout: 60000 }).catch(() => {});
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^0:1\d Écran grisé/ }).click().catch(() => {});
  await wait(1000);
  await smoothScroll(page, "aside.card", 260, 20);
  await wait(3500);
  await page.locator("[data-testid=analysis-panel]").scrollIntoViewIfNeeded();
  await wait(3500);

  // 7 · Coach
  await go(page, `${BASE}/app/coach`);
  await caption(page, "7 · Coach : réponses citant vos clips et vos matchs", "Mode sans IA ici (aucune clé API configurée)");
  await wait(1500);
  await page.getByRole("button", { name: "Quelle meilleure action ?" }).click();
  await page.locator("[data-testid=coach-answer]").first().waitFor({ timeout: 30000 });
  await wait(3500);
  await page.locator("[data-testid=coach-citations] a").first().click();
  await caption(page, "La source ouvre le clip au bon moment");
  await page.waitForURL(/\/app\/videos\//);
  await wait(4000);

  await caption(page, "CoachGG", "Statistiques · vidéo annotée · groupes d'amis — sans conseil pendant la partie");
  await wait(3000);
  const video = page.video();
  await ctx.close();
  await browser.close();
  console.log(await video.path());
})();
