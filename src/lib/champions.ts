// Liste des champions de League of Legends (noms affichés) et recherche tolérante pour l'autocomplétion.
// La saisie reste libre : un champion sorti après cette liste peut toujours être tapé à la main.

export const CHAMPIONS = [
  "Aatrox", "Ahri", "Akali", "Akshan", "Alistar", "Ambessa", "Amumu", "Anivia", "Annie", "Aphelios", "Ashe", "Aurelion Sol", "Aurora", "Azir",
  "Bard", "Bel'Veth", "Blitzcrank", "Brand", "Braum", "Briar",
  "Caitlyn", "Camille", "Cassiopeia", "Cho'Gath", "Corki",
  "Darius", "Diana", "Dr. Mundo", "Draven",
  "Ekko", "Elise", "Evelynn", "Ezreal",
  "Fiddlesticks", "Fiora", "Fizz",
  "Galio", "Gangplank", "Garen", "Gnar", "Gragas", "Graves", "Gwen",
  "Hecarim", "Heimerdinger", "Hwei",
  "Illaoi", "Irelia", "Ivern",
  "Janna", "Jarvan IV", "Jax", "Jayce", "Jhin", "Jinx",
  "K'Sante", "Kai'Sa", "Kalista", "Karma", "Karthus", "Kassadin", "Katarina", "Kayle", "Kayn", "Kennen", "Kha'Zix", "Kindred", "Kled", "Kog'Maw",
  "LeBlanc", "Lee Sin", "Leona", "Lillia", "Lissandra", "Lucian", "Lulu", "Lux",
  "Malphite", "Malzahar", "Maokai", "Master Yi", "Mel", "Milio", "Miss Fortune", "Mordekaiser", "Morgana",
  "Naafiri", "Nami", "Nasus", "Nautilus", "Neeko", "Nidalee", "Nilah", "Nocturne", "Nunu & Willump",
  "Olaf", "Orianna", "Ornn",
  "Pantheon", "Poppy", "Pyke",
  "Qiyana", "Quinn",
  "Rakan", "Rammus", "Rek'Sai", "Rell", "Renata Glasc", "Renekton", "Rengar", "Riven", "Rumble", "Ryze",
  "Samira", "Sejuani", "Senna", "Seraphine", "Sett", "Shaco", "Shen", "Shyvana", "Singed", "Sion", "Sivir", "Skarner", "Smolder", "Sona", "Soraka", "Swain", "Sylas", "Syndra",
  "Tahm Kench", "Taliyah", "Talon", "Taric", "Teemo", "Thresh", "Tristana", "Trundle", "Tryndamere", "Twisted Fate", "Twitch",
  "Udyr", "Urgot",
  "Varus", "Vayne", "Veigar", "Vel'Koz", "Vex", "Vi", "Viego", "Viktor", "Vladimir", "Volibear",
  "Warwick", "Wukong",
  "Xayah", "Xerath", "Xin Zhao",
  "Yasuo", "Yone", "Yorick", "Yunara", "Yuumi",
  "Zac", "Zed", "Zeri", "Ziggs", "Zilean", "Zoe", "Zyra",
] as const;

/** « Kai'Sa » → « kaisa », « Dr. Mundo » → « drmundo » : accents, espaces et ponctuation ignorés. */
export function normalizeChampion(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Surnoms courants → nom officiel. */
const ALIASES: Record<string, string> = {
  mf: "Miss Fortune", tf: "Twisted Fate", asol: "Aurelion Sol", j4: "Jarvan IV", jarvan: "Jarvan IV", mundo: "Dr. Mundo",
  yi: "Master Yi", lee: "Lee Sin", nunu: "Nunu & Willump", renata: "Renata Glasc", kogmaw: "Kog'Maw", tahm: "Tahm Kench",
  xin: "Xin Zhao", monkeyking: "Wukong", cass: "Cassiopeia", heimer: "Heimerdinger", fiddle: "Fiddlesticks", kassa: "Kassadin",
  kata: "Katarina", blitz: "Blitzcrank", morde: "Mordekaiser", voli: "Volibear", trynda: "Tryndamere", gp: "Gangplank",
};

/**
 * Champions correspondant à la saisie : d'abord ceux qui commencent par le texte, puis ceux qui le contiennent.
 * Vide → aucune suggestion.
 */
export function searchChampions(query: string, limit = 8, exclude: readonly string[] = []): string[] {
  const q = normalizeChampion(query);
  if (!q) return [];
  const skip = new Set(exclude.map(normalizeChampion));
  const alias = ALIASES[q];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const c of CHAMPIONS) {
    const n = normalizeChampion(c);
    if (skip.has(n)) continue;
    if (n.startsWith(q) || c.split(/[\s'.&]+/).some((w) => normalizeChampion(w).startsWith(q))) starts.push(c);
    else if (n.includes(q)) contains.push(c);
  }
  const out = [...(alias && !skip.has(normalizeChampion(alias)) ? [alias] : []), ...starts, ...contains];
  return [...new Set(out)].slice(0, limit);
}

/** Nom officiel si la saisie correspond exactement à un champion (casse et ponctuation ignorées), sinon la saisie telle quelle. */
export function canonicalChampion(input: string): string {
  const q = normalizeChampion(input);
  return CHAMPIONS.find((c) => normalizeChampion(c) === q) ?? ALIASES[q] ?? input.trim();
}
