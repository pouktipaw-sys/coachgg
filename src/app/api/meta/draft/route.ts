// Aide à la sélection (site et application PC pendant la sélection des champions).
import { z } from "zod";
import { authedOrDevice, json } from "@/server/http";
import { draftAdvice } from "@/server/meta";
import { ddChampions, findChampion } from "@/server/riot/ddragon";

export const GET = authedOrDevice(async (req) => {
  const sp = new URL(req.url).searchParams;
  const q = z
    .object({ role: z.enum(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]), enemy: z.coerce.number().int().positive().optional(), taken: z.string().max(200).optional() })
    .parse({ role: sp.get("role"), enemy: sp.get("enemy") ?? undefined, taken: sp.get("taken") ?? undefined });
  const taken = (q.taken ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 20);
  const advice = await draftAdvice({ role: q.role, enemyLaner: q.enemy ?? null, taken });
  const champs = await ddChampions().catch(() => []);
  const named = <T extends { championId: number }>(l: T[]) => l.map((x) => ({ ...x, name: findChampion(champs, x.championId)?.name ?? `#${x.championId}` }));
  return json({ advice: advice && { ...advice, counters: named(advice.counters), best: named(advice.best), bans: named(advice.bans) } });
});
