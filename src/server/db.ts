import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "@/lib/loadEnv";

// Prisma 7 : connexion via l'adaptateur pg (plus de moteur Rust ni de lecture
// automatique de .env). Next.js charge .env lui-même ; le worker et les scripts
// (tsx) le chargent ici, sans écraser les variables déjà définies.
if (!process.env.DATABASE_URL && existsSync(".env")) loadEnv(".env");

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL n'est pas défini.");
  return new PrismaClient({
    // Session en UTC, quel que soit le fuseau du serveur PostgreSQL (Windows : heure locale).
    adapter: new PrismaPg({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10), options: "-c TimeZone=UTC" }),
    log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

const g = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma = g.__prisma ?? createClient();

if (process.env.NODE_ENV !== "production") g.__prisma = prisma;
