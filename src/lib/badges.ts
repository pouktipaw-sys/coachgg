// Forme du moment, séries et badges — calculés uniquement à partir de parties réelles (fonctions pures).
export type GameLite = {
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  visionScore: number | null;
  creepScore: number | null;
  durationSec: number;
  score: number | null; // note CoachGG
  playedAt: Date;
};

export type Badge = { key: string; icon: string; label: string; detail: string };

/** Parties triées de la plus récente à la plus ancienne. */
export function form(games: GameLite[], n = 5) {
  return games.slice(0, n).map((g) => (g.win ? "V" : "D"));
}

export function streak(games: GameLite[]): { kind: "V" | "D"; n: number } | null {
  if (!games.length) return null;
  const kind = games[0]!.win ? "V" : "D";
  let n = 0;
  for (const g of games) {
    if ((g.win ? "V" : "D") !== kind) break;
    n++;
  }
  return { kind, n };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function badges(games: GameLite[], mvpVotes: number, now = new Date()): Badge[] {
  const out: Badge[] = [];
  const s = streak(games);
  if (s?.kind === "V" && s.n >= 3) out.push({ key: "ON_FIRE", icon: "🔥", label: "En feu", detail: `${s.n} victoires d'affilée` });
  if (mvpVotes >= 1) out.push({ key: "MVP", icon: "🏆", label: mvpVotes >= 5 ? "Légende du MVP" : "Élu MVP", detail: `${mvpVotes} vote(s) MVP de ses coéquipiers` });
  const last10 = games.slice(0, 10);
  const vision = avg(last10.map((g) => g.visionScore).filter((x): x is number => x != null));
  if (last10.length >= 5 && vision != null && vision >= 35) out.push({ key: "EAGLE_EYE", icon: "👁️", label: "Œil de lynx", detail: `vision moyenne ${Math.round(vision)} sur ${last10.length} parties` });
  const csMin = avg(last10.filter((g) => g.creepScore != null && g.durationSec >= 600).map((g) => g.creepScore! / (g.durationSec / 60)));
  if (last10.length >= 5 && csMin != null && csMin >= 7) out.push({ key: "FARMER", icon: "🌾", label: "Fermier d'élite", detail: `${csMin.toFixed(1)} CS/min en moyenne` });
  const flawless = games.slice(0, 20).find((g) => g.deaths === 0 && g.kills + g.assists >= 8);
  if (flawless) out.push({ key: "UNTOUCHABLE", icon: "🛡️", label: "Intouchable", detail: `${flawless.kills}/0/${flawless.assists} sur une partie récente` });
  const scores = last10.map((g) => g.score).filter((x): x is number => x != null);
  const sc = avg(scores);
  if (scores.length >= 5 && sc != null && sc >= 7) out.push({ key: "CONSISTENT", icon: "📈", label: "Régulier", detail: `note CoachGG moyenne ${sc.toFixed(1)}/10` });
  const week = games.filter((g) => now.getTime() - g.playedAt.getTime() <= 7 * 86400_000).length;
  if (week >= 10) out.push({ key: "GRINDER", icon: "🎮", label: "Assidu", detail: `${week} parties cette semaine` });
  return out;
}

/** Couleur stable dérivée d'un nom (avatar). */
export function avatarHue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
