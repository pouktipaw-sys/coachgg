import { defineConfig } from "@playwright/test";

// Tests de bout en bout : serveur Next + worker réels, base dédiée « coachgg_e2e ».
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://coachgg:coachgg@localhost:5432/coachgg_e2e";
const env = {
  DATABASE_URL: DB,
  STORAGE_DIR: "./tests/.storage-e2e",
  APP_URL: "http://localhost:3100",
  DISABLE_RATE_LIMIT: "1",
  RIOT_API_KEY: "",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", viewport: { width: 1440, height: 900 }, trace: "off" },
  webServer: [
    {
      command: "npx prisma migrate deploy && npx next dev -p 3100",
      url: "http://localhost:3100",
      env,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npx tsx src/worker/index.ts",
      env,
      wait: { stdout: /démarré/ },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
