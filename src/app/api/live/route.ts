// Partie en cours (site et application PC à l'écran de chargement) : par défaut, le compte Riot principal de l'utilisateur.
import { authedOrDevice, json } from "@/server/http";
import { prisma } from "@/server/db";
import { badRequest } from "@/server/errors";
import { liveGame } from "@/server/riot/explorer";

export const GET = authedOrDevice(async (req, user) => {
  const sp = new URL(req.url).searchParams;
  let riotId = sp.get("riotId");
  let platform = sp.get("platform");
  if (!riotId) {
    const id = await prisma.gameIdentity.findFirst({ where: { userId: user.id, isPrimary: true } });
    if (!id) throw badRequest("Associe ton Riot ID dans les paramètres.");
    riotId = `${id.gameName}#${id.tagLine}`;
    platform ??= id.platform;
  }
  return json(await liveGame(riotId, platform ?? "EUW1"));
});
