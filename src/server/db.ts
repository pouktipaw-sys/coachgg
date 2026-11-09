import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Prisma 7 : connexion via l'adaptateur pg (plus de moteur Rust ni de lecture
// automatique de .env). Next.js charge .env lui-même ; le worker et les scripts
// (tsx) le chargent ici, sans écraser les variables déjà définies.
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL n'est pas défini.");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10) }),
    log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

const g = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma = g.__prisma ?? createClient();

if (process.env.NODE_ENV !== "production") g.__prisma = prisma;
