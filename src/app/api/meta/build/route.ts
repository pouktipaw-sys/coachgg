// Build « méta » d'un champion (site et application PC) : page de runes au format du client LoL, objets.
import { z } from "zod";
import { authedOrDevice, json } from "@/server/http";
import { metaBuild } from "@/server/meta";
import { ddItems, isFinishedItem } from "@/server/riot/ddragon";
import { parseRunePageKey } from "@/lib/riot/meta";

export const GET = authedOrDevice(async (req) => {
  const q = z
    .object({ championId: z.coerce.number().int().positive(), role: z.enum(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY", "ANY"]).optional(), mode: z.enum(["RANKED", "ARAM", "ARENA"]).optional() })
    .parse(Object.fromEntries(new URL(req.url).searchParams));
  const mode = q.mode ?? "RANKED";
  const b = await metaBuild(q.championId, mode === "RANKED" ? q.role : "ANY", undefined, mode);
  if (!b) return json({ build: null });
  const items = await ddItems().catch(() => null);
  const finished = b.items.filter((i) => (items ? isFinishedItem(items[String(i.itemId)]) : true));
  // Ordre d'achat : les 3 premiers objets de l'ordre le plus fréquent, puis les autres objets les plus construits.
  const core = b.core[0]?.key.split(">").map(Number) ?? [];
  const ordered = [...core, ...finished.map((i) => i.itemId).filter((id) => !core.includes(id))].slice(0, 6);
  return json({
    build: {
      patch: b.patch, role: b.role, games: b.games, winrate: b.winrate,
      runes: b.runes[0] ? { ...parseRunePageKey(b.runes[0].pageKey), games: b.runes[0].games, winrate: b.runes[0].winrate } : null,
      items: ordered.map((id) => ({ itemId: id, name: items?.[String(id)]?.name ?? null })),
      spells: b.spells[0]?.key.split(",").map(Number) ?? null,
      skillOrder: b.skills[0]?.key ?? null,
    },
  });
});
