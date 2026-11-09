// Configuration Prisma 7 (CLI : migrations, génération).
// Prisma 7 ne lit plus le fichier .env : on le charge ici (sans écraser les
// variables déjà définies, ex. DATABASE_URL des tests).
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
