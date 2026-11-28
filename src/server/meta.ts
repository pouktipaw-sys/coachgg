// Statistiques « méta » : collecte de parties classées publiques (tâche META_CRAWL) et lecture des agrégats
// (tier list, build d'un champion, contres, aide à la sélection).
// • Désactivé par défaut (META_CRAWL_PLATFORMS vide) : la collecte consomme le quota de la clé Riot.
// • Avec une clé de développement (100 requêtes / 2 min) : quelques centaines de parties par heure.
import type { AnalysisJob } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { enqueueJob } from "./jobs";
import { type RiotClient, type RiotMatch, riotClient } from "./riot/client";
import { META_MODES, META_TIERS, type MetaMode, bucketKeys, metaPatchKey, metaRows, parseMetaKey, patchOfKey, tierList, timelineChoices, type MetaRows } from "@/lib/riot/meta";
import { ddItems, isFinishedItem } from "./riot/ddragon";

const RANKED_SOLO = 420;

export function metaConfig() {
  const platforms = (process.env.META_CRAWL_PLATFORMS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const modes = (process.env.META_CRAWL_MODES ?? "RANKED").split(",").map((s) => s.trim().toUpperCase()).filter((m): m is MetaMode => m in META_MODES);
  const tiers = (process.env.META_CRAWL_TIERS ?? "CHALLENGER,GRANDMASTER").split(",").map((s) => s.trim().toUpperCase()).filter((t) => (META_TIERS as readonly string[]).includes(t));
  return {
    platforms,
    perRun: Math.max(10, Math.min(100_000, Number(process.env.META_CRAWL_MATCHES_PER_RUN) || 150)),
    modes: modes.length ? modes : (["RANKED"] as MetaMode[]),
    // Rangs dont on collecte les parties (seaux « par rang ») : « IRON,…,CHALLENGER » ou « ALL » pour tous.
    tiers: process.env.META_CRAWL_TIERS?.trim().toUpperCase() === "ALL" ? [...META_TIERS] : tiers.length ? tiers : ["CHALLENGER", "GRANDMASTER"],
    // Timeline (ordre des sorts et des objets) : une requête de plus par partie. META_CRAWL_TIMELINES=0 pour s'en passer.
    timelines: process.env.META_CRAWL_TIMELINES !== "0",
    // Fréquence des collectes (minutes) : 60 par défaut ; plus court avec une clé de production.
    everyMin: Math.max(5, Math.min(1440, Number(process.env.META_CRAWL_EVERY_MIN) || 60)),
  };
}

/** Ajoute les lignes d'une partie aux agrégats (une requête par table, additions atomiques). */
export async function applyMetaRows(riotMatchId: string, platform: string, r: MetaRows, tier: string | null = null) {
  const v = <T,>(rows: T[], f: (x: T) => Prisma.Sql) => Prisma.join(rows.map(f));
  await prisma.$transaction(async (tx) => {
    // Idempotent : une partie déjà comptée ne l'est pas deux fois.
    const inserted = await tx.$executeRaw`INSERT INTO "MetaMatch" ("riotMatchId","platform","patch") VALUES (${riotMatchId}, ${platform}, ${r.patch}) ON CONFLICT DO NOTHING`;
    if (!inserted) return;
    // Seaux : tous rangs et serveurs, ce serveur, ce rang, ce rang sur ce serveur.
    for (const patch of bucketKeys(r.patch, tier, platform)) {
      await tx.$executeRaw`INSERT INTO "MetaPatch" ("patch","games") VALUES (${patch}, 1) ON CONFLICT ("patch") DO UPDATE SET "games" = "MetaPatch"."games" + 1`;
      await tx.$executeRaw`INSERT INTO "MetaChampionStat" ("patch","championId","role","games","wins") VALUES ${v(r.champs, (c) => Prisma.sql`(${patch}, ${c.championId}, ${c.role}, 1, ${c.win ? 1 : 0})`)}
        ON CONFLICT ("patch","championId","role") DO UPDATE SET "games" = "MetaChampionStat"."games" + 1, "wins" = "MetaChampionStat"."wins" + EXCLUDED."wins"`;
      if (r.bans.length)
        await tx.$executeRaw`INSERT INTO "MetaBan" ("patch","championId","bans") VALUES ${v(r.bans, (b) => Prisma.sql`(${patch}, ${b}, 1)`)}
          ON CONFLICT ("patch","championId") DO UPDATE SET "bans" = "MetaBan"."bans" + 1`;
      if (r.items.length)
        await tx.$executeRaw`INSERT INTO "MetaItemStat" ("patch","championId","role","itemId","games","wins") VALUES ${v(r.items, (i) => Prisma.sql`(${patch}, ${i.championId}, ${i.role}, ${i.itemId}, 1, ${i.win ? 1 : 0})`)}
          ON CONFLICT ("patch","championId","role","itemId") DO UPDATE SET "games" = "MetaItemStat"."games" + 1, "wins" = "MetaItemStat"."wins" + EXCLUDED."wins"`;
      if (r.runes.length)
        await tx.$executeRaw`INSERT INTO "MetaRunePage" ("patch","championId","role","pageKey","games","wins") VALUES ${v(r.runes, (x) => Prisma.sql`(${patch}, ${x.championId}, ${x.role}, ${x.pageKey}, 1, ${x.win ? 1 : 0})`)}
          ON CONFLICT ("patch","championId","role","pageKey") DO UPDATE SET "games" = "MetaRunePage"."games" + 1, "wins" = "MetaRunePage"."wins" + EXCLUDED."wins"`;
      if (r.choices.length)
        await tx.$executeRaw`INSERT INTO "MetaChoice" ("patch","championId","role","kind","key","games","wins") VALUES ${v(r.choices, (x) => Prisma.sql`(${patch}, ${x.championId}, ${x.role}, ${x.kind}, ${x.key}, 1, ${x.win ? 1 : 0})`)}
          ON CONFLICT ("patch","championId","role","kind","key") DO UPDATE SET "games" = "MetaChoice"."games" + 1, "wins" = "MetaChoice"."wins" + EXCLUDED."wins"`;
      if (r.matchups.length)
        await tx.$executeRaw`INSERT INTO "MetaMatchup" ("patch","championId","role","opponentId","games","wins") VALUES ${v(r.matchups, (x) => Prisma.sql`(${patch}, ${x.championId}, ${x.role}, ${x.opponentId}, 1, ${x.win ? 1 : 0})`)}
          ON CONFLICT ("patch","championId","role","opponentId") DO UPDATE SET "games" = "MetaMatchup"."games" + 1, "wins" = "MetaMatchup"."wins" + EXCLUDED."wins"`;
    }
    if (r.players.length)
      await tx.$executeRaw`INSERT INTO "MetaPlayerChampion" ("puuid","championId","platform","riotId","games","wins","lastPlayed") VALUES ${v(r.players, (x) => Prisma.sql`(${x.puuid}, ${x.championId}, ${platform}, ${x.riotId}, 1, ${x.win ? 1 : 0}, now())`)}
        ON CONFLICT ("puuid","championId") DO UPDATE SET "games" = "MetaPlayerChampion"."games" + 1, "wins" = "MetaPlayerChampion"."wins" + EXCLUDED."wins", "riotId" = COALESCE(EXCLUDED."riotId", "MetaPlayerChampion"."riotId"), "lastPlayed" = now()`;
  });
}

const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
};

/** Joueurs d'un rang : ligues Challenger/Grand maître/Maître, sinon une division et une page au hasard. */
async function seedsFor(client: RiotClient, platform: string, tier: string): Promise<string[]> {
  if (tier === "CHALLENGER" || tier === "GRANDMASTER" || tier === "MASTER") {
    const l = await client.apexLeague(tier.toLowerCase() as "challenger", "RANKED_SOLO_5x5", platform).catch(() => ({ entries: [] }));
    return l.entries.map((e) => e.puuid);
  }
  const div = ["I", "II", "III", "IV"][Math.floor(Math.random() * 4)]!;
  const page = 1 + Math.floor(Math.random() * 3);
  return (await client.leagueExp(tier, div, page, platform).catch(() => [])).map((e) => e.puuid);
}

/**
 * Collecte : joueurs de chaque rang demandé, leurs dernières parties de chaque mode (classée solo/duo, ARAM, Arena),
 * jusqu'à `max` parties nouvelles au total, réparties entre rangs et modes. Une partie est rangée dans le seau du rang
 * du joueur par lequel on l'a trouvée (approximation habituelle des sites de statistiques). Parties déjà comptées
 * ignorées sans requête. Avec `timelines`, une requête de plus par partie (ordre des sorts et des objets).
 */
export async function crawlMeta(platform: string, max: number, client: RiotClient, opts: { modes?: MetaMode[]; timelines?: boolean; tiers?: string[] } = {}) {
  const modes = opts.modes?.length ? opts.modes : (["RANKED"] as MetaMode[]);
  const tiers = opts.tiers?.length ? opts.tiers : ["CHALLENGER", "GRANDMASTER"];
  const items = opts.timelines ? await ddItems().catch(() => null) : null;
  const finished = (id: number) => (items ? isFinishedItem(items[String(id)]) : false);
  let added = 0;
  let skipped = 0;
  let requests = 0;
  let seedCount = 0;
  const per = Math.max(1, Math.ceil(max / (modes.length * tiers.length)));
  const byMode: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const tier of tiers) {
    const seeds = shuffle(await seedsFor(client, platform, tier));
    requests++;
    seedCount += seeds.length;
    for (const mode of modes) {
      let n = 0;
      for (const puuid of seeds) {
        if (n >= per || added >= max) break;
        const ids = await client.matchIds(puuid, platform, 20, 0, { queue: META_MODES[mode] }).catch(() => [] as string[]);
        requests++;
        if (!ids.length) continue;
        const known = new Set((await prisma.metaMatch.findMany({ where: { riotMatchId: { in: ids } }, select: { riotMatchId: true } })).map((m) => m.riotMatchId));
        for (const id of ids) {
          if (n >= per || added >= max) break;
          if (known.has(id)) continue;
          let m: RiotMatch;
          try {
            m = await client.match(id);
            requests++;
          } catch {
            continue;
          }
          const rows = m.info.queueId === META_MODES[mode] ? metaRows(m, mode) : null;
          if (!rows) {
            skipped++;
            continue;
          }
          if (opts.timelines && items) {
            const tl = await client.timeline(id).catch(() => null);
            requests++;
            if (tl) rows.choices.push(...timelineChoices(tl, m, mode, finished));
          }
          await applyMetaRows(id, platform, rows, tier);
          added++;
          n++;
          byMode[mode] = (byMode[mode] ?? 0) + 1;
          byTier[tier] = (byTier[tier] ?? 0) + 1;
        }
      }
    }
  }
  return { platform, added, skipped, seeds: seedCount, requests, byMode, byTier };
}

/** Tâche de fond (worker). */
export async function runMetaCrawl(job: AnalysisJob) {
  const p = (job.payload ?? {}) as { platform?: string; max?: number };
  const cfg = metaConfig();
  // Le limiteur suit les quotas de Riot : attentes jusqu'à 2 min au lieu d'erreurs 429.
  const c = riotClient(undefined, { maxRetries: 6, maxWaitSec: 120 });
  return crawlMeta(p.platform ?? "EUW1", p.max ?? cfg.perRun, c, { modes: cfg.modes, timelines: cfg.timelines, tiers: cfg.tiers });
}

/**
 * Planifie une collecte par serveur configuré, toutes les `META_CRAWL_EVERY_MIN` minutes (clé d'idempotence par créneau).
 * `rush` : nouveau patch détecté → collecte immédiate supplémentaire, pour des statistiques à jour au plus vite.
 */
export async function scheduleMetaCrawls(now = new Date(), opts: { rush?: string } = {}) {
  const { platforms, perRun, everyMin } = metaConfig();
  if (!platforms.length || !process.env.RIOT_API_KEY) return 0;
  const slot = Math.floor(now.getTime() / (everyMin * 60_000));
  for (const platform of platforms)
    await enqueueJob({ type: "META_CRAWL", idempotencyKey: opts.rush ? `meta:${platform}:patch:${opts.rush}` : `meta:${platform}:${everyMin}:${slot}`, payload: { platform, max: perRun }, maxAttempts: 1 });
  return platforms.length;
}

// ───────────── Lecture ─────────────

/** Seau le plus récent (mode, rang, serveur) qui a assez de parties, sinon le plus récent tout court. Clé de stockage. */
export async function currentPatch(min = 200, mode: MetaMode = "RANKED", tier = "ALL", platform = "ALL") {
  const patches = (await prisma.metaPatch.findMany()).filter((p) => {
    const k = parseMetaKey(p.patch);
    return k.mode === mode && k.tier === tier && k.platform === platform;
  });
  if (!patches.length) return null;
  const byVersion = patches.sort((a, b) => patchOfKey(b.patch).localeCompare(patchOfKey(a.patch), undefined, { numeric: true }));
  return (byVersion.find((p) => p.games >= min) ?? byVersion[0]!).patch;
}

/**
 * Vue d'ensemble d'un seau. Juste après un patch, le nouveau a encore peu de parties : on affiche le précédent
 * (plus fiable) et `newer` signale le nouveau patch en cours de collecte.
 */
export async function metaOverview(patchIn?: string, mode: MetaMode = "RANKED", tier = "ALL", platform = "ALL") {
  const key = patchIn ? metaPatchKey(patchIn, mode, tier, platform) : await currentPatch(200, mode, tier, platform);
  if (!key) return null;
  const all = (await prisma.metaPatch.findMany()).filter((x) => {
    const k = parseMetaKey(x.patch);
    return k.mode === mode && k.tier === tier && k.platform === platform;
  });
  const sorted = all.sort((a, b) => patchOfKey(b.patch).localeCompare(patchOfKey(a.patch), undefined, { numeric: true }));
  const games = all.find((x) => x.patch === key)?.games ?? 0;
  const newest = sorted[0];
  return {
    key, patch: patchOfKey(key), mode, tier, platform, games,
    newer: newest && newest.patch !== key ? { patch: patchOfKey(newest.patch), games: newest.games } : null,
    patches: sorted.map((x) => ({ patch: patchOfKey(x.patch), games: x.games })),
  };
}

export async function metaTierList(patch: string, role?: string) {
  const games = (await prisma.metaPatch.findUnique({ where: { patch } }))?.games ?? 0;
  const [stats, bans] = await Promise.all([
    prisma.metaChampionStat.findMany({ where: { patch, ...(role ? { role } : {}) } }),
    prisma.metaBan.findMany({ where: { patch } }),
  ]);
  // Seuil d'échantillon : au moins 20 parties, et 0,3 % des parties du patch quand il y en a beaucoup.
  const minGames = Math.max(20, Math.round(games * 0.003));
  return { games, minGames, rows: tierList(stats, games, new Map(bans.map((b) => [b.championId, b.bans])), minGames) };
}

/** Build « méta » d'un champion à un rôle : rôle principal si absent, objets, runes, sorts, ordre des sorts et des objets, contres. */
export async function metaBuild(championId: number, roleIn?: string, patchIn?: string, mode: MetaMode = "RANKED", bucket: { tier?: string; platform?: string } = {}) {
  const patch = patchIn ?? (await currentPatch(200, mode, bucket.tier ?? "ALL", bucket.platform ?? "ALL"));
  if (!patch) return null;
  const roles = await prisma.metaChampionStat.findMany({ where: { patch, championId }, orderBy: { games: "desc" } });
  if (!roles.length) return null;
  const role = roleIn && roles.some((r) => r.role === roleIn) ? roleIn : roles[0]!.role;
  const stat = roles.find((r) => r.role === role)!;
  const [items, runes, matchups, choices] = await Promise.all([
    prisma.metaItemStat.findMany({ where: { patch, championId, role }, orderBy: { games: "desc" }, take: 40 }),
    prisma.metaRunePage.findMany({ where: { patch, championId, role }, orderBy: { games: "desc" }, take: 5 }),
    prisma.metaMatchup.findMany({ where: { patch, championId, role, games: { gte: 5 } } }),
    prisma.metaChoice.findMany({ where: { patch, championId, role }, orderBy: { games: "desc" } }),
  ]);
  const choice = (kind: string) =>
    choices.filter((c) => c.kind === kind).slice(0, 3).map((c) => ({ key: c.key, games: c.games, winrate: Math.round((c.wins / c.games) * 1000) / 10, pickrate: Math.round((c.games / stat.games) * 100) }));
  const wr = (w: number, g: number) => Math.round((w / g) * 1000) / 10;
  const mu = matchups.map((m) => ({ opponentId: m.opponentId, games: m.games, winrate: wr(m.wins, m.games) }));
  return {
    patch, role, roles: roles.map((r) => ({ role: r.role, games: r.games })),
    games: stat.games, winrate: wr(stat.wins, stat.games),
    items: items.map((i) => ({ itemId: i.itemId, games: i.games, winrate: wr(i.wins, i.games), pickrate: Math.round((i.games / stat.games) * 100) })),
    runes: runes.map((r) => ({ pageKey: r.pageKey, games: r.games, winrate: wr(r.wins, r.games), pickrate: Math.round((r.games / stat.games) * 100) })),
    spells: choice("spells"),
    skills: choice("skills"),
    core: choice("core"),
    strongAgainst: [...mu].sort((a, b) => b.winrate - a.winrate).slice(0, 5),
    weakAgainst: [...mu].sort((a, b) => a.winrate - b.winrate).slice(0, 5),
  };
}

/**
 * Aide à la sélection : pour ton rôle, les meilleurs choix contre l'adversaire de voie (si connu) et dans la méta,
 * et les bannissements les plus rentables (taux de victoire × popularité). Champions déjà pris exclus.
 */
export async function draftAdvice(input: { role: string; enemyLaner?: number | null; taken: number[]; patch?: string }) {
  const patch = input.patch ?? (await currentPatch());
  if (!patch) return null;
  const tl = await metaTierList(patch);
  const taken = new Set(input.taken);
  const pool = tl.rows.filter((r) => r.role === input.role && !taken.has(r.championId));
  let counters: { championId: number; games: number; winrate: number }[] = [];
  if (input.enemyLaner) {
    const mu = await prisma.metaMatchup.findMany({ where: { patch, role: input.role, opponentId: input.enemyLaner, games: { gte: 8 } } });
    counters = mu
      .filter((m) => !taken.has(m.championId))
      .map((m) => ({ championId: m.championId, games: m.games, winrate: Math.round((m.wins / m.games) * 1000) / 10 }))
      .sort((a, b) => b.winrate - a.winrate)
      .slice(0, 6);
  }
  const bans = [...tl.rows]
    .filter((r) => !taken.has(r.championId))
    .sort((a, b) => (b.winrate - 50) * b.pickrate - (a.winrate - 50) * a.pickrate)
    .filter((r, i, all) => all.findIndex((x) => x.championId === r.championId) === i)
    .slice(0, 5);
  return { patch, games: tl.games, counters, best: pool.slice(0, 6), bans };
}

/** Meilleurs joueurs d'un champion (parties classées collectées) : au moins 5 parties, taux ajusté à l'échantillon. */
export async function championLeaders(championId: number, opts: { platform?: string; take?: number } = {}) {
  const rows = await prisma.metaPlayerChampion.findMany({ where: { championId, games: { gte: 5 }, ...(opts.platform ? { platform: opts.platform } : {}) }, take: 500 });
  return rows
    .map((r) => ({ puuid: r.puuid, riotId: r.riotId, platform: r.platform, games: r.games, wins: r.wins, winrate: Math.round((r.wins / r.games) * 1000) / 10, score: (r.wins + 5) / (r.games + 10) }))
    .sort((a, b) => b.score - a.score || b.games - a.games)
    .slice(0, opts.take ?? 20);
}

const pct = (w: number, g: number) => Math.round((w / g) * 1000) / 10;

/** Build contre un adversaire précis (même rôle) : résultat du matchup, page de runes et ordre des objets les plus joués. */
export async function metaVersus(championId: number, role: string, opponentId: number, patch: string) {
  const [mu, choices] = await Promise.all([
    prisma.metaMatchup.findUnique({ where: { patch_championId_role_opponentId: { patch, championId, role, opponentId } } }),
    prisma.metaChoice.findMany({ where: { patch, championId, role, kind: { in: [`rune@${opponentId}`, `core@${opponentId}`] } }, orderBy: { games: "desc" } }),
  ]);
  if (!mu) return null;
  const top = (kind: string) => {
    const c = choices.find((x) => x.kind === kind);
    return c ? { key: c.key, games: c.games, winrate: pct(c.wins, c.games) } : null;
  };
  return { opponentId, games: mu.games, winrate: pct(mu.wins, mu.games), runes: top(`rune@${opponentId}`), core: top(`core@${opponentId}`) };
}

/** Synergies : pour chaque rôle allié, les champions avec qui ce champion gagne le plus (≥ 5 parties, taux ajusté). */
export async function metaSynergies(championId: number, role: string, patch: string) {
  const rows = await prisma.metaChoice.findMany({ where: { patch, championId, role, kind: { startsWith: "ally:" }, games: { gte: 5 } } });
  const byRole = new Map<string, { allyId: number; games: number; winrate: number; score: number }[]>();
  for (const r of rows) {
    const allyRole = r.kind.slice(5);
    byRole.set(allyRole, [...(byRole.get(allyRole) ?? []), { allyId: Number(r.key), games: r.games, winrate: pct(r.wins, r.games), score: (r.wins + 10) / (r.games + 20) }]);
  }
  return [...byRole.entries()].map(([allyRole, list]) => ({ role: allyRole, best: list.sort((a, b) => b.score - a.score).slice(0, 3) }));
}
