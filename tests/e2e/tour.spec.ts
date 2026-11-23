// Visite visuelle (captures d'écran de toutes les pages clés, bureau + mobile) : TOUR=1 npx playwright test tour --trace off
// Sert à vérifier le design ; ignorée par défaut.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.TOUR, "visite visuelle : TOUR=1");

const FIX = path.resolve(__dirname, "../fixtures/generated");
const OUT = process.env.TOUR_OUT ?? "test-results/tour";

test("visite visuelle", async ({ page, browser }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(path.join(FIX, "two-deaths.mp4")))
    execSync("ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 50 -vf \"hue=s=0:enable='between(t,13,18)+between(t,33,38)'\" -c:v libx264 -pix_fmt yuv420p two-deaths.mp4", { cwd: FIX });
  const email = `tour-${Date.now()}@e2e.dev`;
  await page.goto("/register");
  await page.fill("#displayName", "Morjinho");
  await page.fill("#email", email);
  await page.fill("#password", "motdepasse-e2e");
  await page.click("button:has-text('Créer un compte')");
  await page.waitForURL("**/app/onboarding");
  const champs = ["Ahri", "Yasuo", "Ahri", "Zoe", "Ashe", "Ahri", "Zed", "Ahri"];
  for (let i = 0; i < champs.length; i++) {
    const r = await page.request.post("/api/matches", {
      data: {
        durationSec: 1500 + i * 60,
        gameMode: "RANKED_SOLO",
        participants: [{ isMe: true, championName: champs[i], role: "MIDDLE", teamSide: 100, win: i % 3 !== 1, kills: 3 + (i * 7) % 11, deaths: 2 + (i * 3) % 6, assists: 4 + (i * 5) % 9, creepScore: 160 + i * 12, damageToChampions: 15000 + i * 2500, damageToObjectives: 3000 + i * 400, visionScore: 12 + i * 3 }],
        teamTotals: { "100": { kills: 20 + i, damageToChampions: 80000, damageToObjectives: 25000 } },
      },
    });
    expect(r.status()).toBe(201);
  }
  // Vidéo analysée (deux écrans de mort)
  await page.goto("/app/videos/upload");
  await page.waitForLoadState("networkidle");
  await page.setInputFiles("[data-testid=file-input]", path.join(FIX, "two-deaths.mp4"));
  await page.click("button:has-text('Envoyer la vidéo')");
  await expect(page.getByText("Vidéo prête")).toBeVisible({ timeout: 90_000 });
  await page.click("text=Ouvrir le lecteur de coaching");
  await page.waitForSelector("[data-testid=coaching-studio]");
  const studio = page.url();
  await page.waitForTimeout(12_000); // analyse automatique

  const shot = async (p: Page, name: string, url: string, full = true) => {
    await p.goto(url);
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  };
  await shot(page, "01-dashboard", "/app");
  await shot(page, "02-studio", studio, false);
  await page.locator("[data-testid=video]").evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 12; });
  await page.getByRole("tabpanel").or(page.locator("aside")).locator("button", { hasText: "Écran grisé" }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02b-studio-moment.png`, fullPage: true });
  await shot(page, "03-matches", "/app/matches");
  await shot(page, "04-progress", "/app/progress");
  await shot(page, "05-skills", "/app/skills");
  await shot(page, "06-community", "/app/community");
  await shot(page, "07-friends", "/app/friends");
  await shot(page, "08-videos", "/app/videos");
  await shot(page, "09-settings", "/app/settings");
  await shot(page, "10-home", "/");

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  await shot(m, "20-mobile-dashboard", "/app");
  await shot(m, "21-mobile-studio", studio);
  await shot(m, "22-mobile-community", "/app/community");
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log("MOBILE_OVERFLOW_PX", overflow);
  await ctx.close();
});
