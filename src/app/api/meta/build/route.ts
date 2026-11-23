// Build « méta » d'un champion (site et application PC) : page de runes au format du client LoL, objets.
import { z } from "zod";
import { authedOrDevice, json } from "@/server/http";
import { metaBuild } from "@/server/meta";
import { ddItems, isFinishedItem } from "@/server/riot/ddragon";
import { parseRunePageKey } from "@/lib/riot/meta";

export const GET = authedOrDevice(async (req) => {
  const q = z.object({ championId: z.coerce.number().int().positive(), role: z.enum(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]).optional() }).parse(Object.fromEntries(new URL(req.url).searchParams));
  const b = await metaBuild(q.championId, q.role);
  if (!b) return json({ build: null });
  const items = await ddItems().catch(() => null);
  const finished = b.items.filter((i) => (items ? isFinishedItem(items[String(i.itemId)]) : true));
  return json({
    build: {
      patch: b.patch, role: b.role, games: b.games, winrate: b.winrate,
      runes: b.runes[0] ? { ...parseRunePageKey(b.runes[0].pageKey), games: b.runes[0].games, winrate: b.runes[0].winrate } : null,
      items: finished.slice(0, 6).map((i) => ({ itemId: i.itemId, name: items?.[String(i.itemId)]?.name ?? null, pickrate: i.pickrate, winrate: i.winrate })),
    },
  });
});
