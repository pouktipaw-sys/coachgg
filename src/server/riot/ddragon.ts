// Données officielles du jeu (Data Dragon de Riot, publiques, sans clé) : champions, sorts, objets, runes,
// sorts d'invocateur, en français. Mises en cache en mémoire (12 h) : une seule requête par fichier.
// Les visuels (icônes) sont servis par le CDN de Riot, conformément à son usage public pour les applications tierces.

const CDN = "https://ddragon.leagueoflegends.com";
const TTL_MS = 12 * 3600_000;
type Fetcher = (url: string) => Promise<Response>;
let fetcher: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(10_000) });
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Tests : remplace l'accès réseau et vide le cache. */
export function setDdragonFetcher(f: Fetcher | null) {
  fetcher = f ?? ((url) => fetch(url, { signal: AbortSignal.timeout(10_000) }));
  cache.clear();
}

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load().catch((e) => {
    cache.delete(key); // une erreur ne reste pas en cache
    throw e;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetcher(`${CDN}${path}`);
  if (!r.ok) throw new Error(`Données du jeu indisponibles (${r.status}).`);
  return (await r.json()) as T;
}

export const ddVersion = () => cached("version", async () => (await getJson<string[]>("/api/versions.json"))[0]!);

export type DdChampion = { id: string; key: string; name: string; title: string; tags: string[]; blurb: string; image: { full: string } };
export type DdSpell = { id: string; name: string; description: string; cooldownBurn?: string; costBurn?: string; rangeBurn?: string; image: { full: string } };
export type DdChampionDetail = DdChampion & {
  lore: string;
  allytips: string[];
  enemytips: string[];
  passive: { name: string; description: string; image: { full: string } };
  spells: DdSpell[];
  info: { attack: number; defense: number; magic: number; difficulty: number };
  stats?: Record<string, number>;
};
export type DdItem = { name: string; plaintext?: string; gold: { total: number; purchasable: boolean }; tags: string[]; into?: string[]; from?: string[]; depth?: number; image: { full: string }; maps?: Record<string, boolean> };
export type DdRuneTree = { id: number; key: string; icon: string; name: string; slots: { runes: { id: number; key: string; icon: string; name: string; shortDesc: string }[] }[] };

export const ddChampions = () =>
  cached("champions", async () => {
    const v = await ddVersion();
    const j = await getJson<{ data: Record<string, DdChampion> }>(`/cdn/${v}/data/fr_FR/champion.json`);
    return Object.values(j.data).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  });

export const ddChampionDetail = (id: string, version?: string) =>
  cached(`champion:${id}:${version ?? "current"}`, async () => {
    if (!/^[A-Za-z]+$/.test(id)) throw new Error("Champion inconnu.");
    if (version && !/^[0-9.]+$/.test(version)) throw new Error("Version inconnue.");
    const v = version ?? (await ddVersion());
    const j = await getJson<{ data: Record<string, DdChampionDetail> }>(`/cdn/${v}/data/fr_FR/champion/${id}.json`);
    return j.data[id]!;
  });

export const ddItems = () =>
  cached("items", async () => {
    const v = await ddVersion();
    return (await getJson<{ data: Record<string, DdItem> }>(`/cdn/${v}/data/fr_FR/item.json`)).data;
  });

export const ddRunes = () =>
  cached("runes", async () => {
    const v = await ddVersion();
    return getJson<DdRuneTree[]>(`/cdn/${v}/data/fr_FR/runesReforged.json`);
  });

export const ddSummonerSpells = () =>
  cached("summoners", async () => {
    const v = await ddVersion();
    const j = await getJson<{ data: Record<string, { key: string; name: string; image: { full: string } }> }>(`/cdn/${v}/data/fr_FR/summoner.json`);
    return Object.fromEntries(Object.values(j.data).map((s) => [s.key, { name: s.name, image: s.image.full }]));
  });

/** Normalise un nom de champion (« Kai'Sa », « kaisa », « MonkeyKing »/« Wukong ») pour comparer. */
export const normChamp = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Retrouve un champion par identifiant interne, nom affiché ou numéro. */
export function findChampion(list: DdChampion[], q: string | number): DdChampion | undefined {
  const s = String(q);
  const n = normChamp(s);
  return list.find((c) => c.key === s || normChamp(c.id) === n || normChamp(c.name) === n);
}

/** Texte des descriptions Data Dragon (balises de mise en forme) → texte lisible. */
export function ddText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Objet « fini » (légendaire ou bottes évoluées) : sert à identifier un build, en ignorant composants et consommables. */
export function isFinishedItem(it: DdItem | undefined) {
  if (!it || !it.gold.purchasable) return false;
  if (it.tags.includes("Consumable") || it.tags.includes("Trinket")) return false;
  if (it.tags.includes("Boots")) return (it.depth ?? 1) >= 2 && !(it.into?.length);
  return !(it.into?.length) && it.gold.total >= 2000;
}

export const img = {
  champion: (v: string, file: string) => `${CDN}/cdn/${v}/img/champion/${file}`,
  passive: (v: string, file: string) => `${CDN}/cdn/${v}/img/passive/${file}`,
  spell: (v: string, file: string) => `${CDN}/cdn/${v}/img/spell/${file}`,
  item: (v: string, id: string | number) => `${CDN}/cdn/${v}/img/item/${id}.png`,
  rune: (icon: string) => `${CDN}/cdn/img/${icon}`,
};
