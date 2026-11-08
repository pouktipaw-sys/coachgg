// Donne le rôle ADMIN à un compte existant : npm run admin:promote -- email@exemple.fr
import { prisma } from "../src/server/db";

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) throw new Error("Usage : npm run admin:promote -- email@exemple.fr");
  const u = await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
  console.log(`${u.email} est maintenant administrateur.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
