import { afterAll, beforeEach } from "vitest";
import { prisma } from "@/server/db";

// Nettoie toutes les tables entre les tests (ordre indifférent grâce à CASCADE).
beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});
