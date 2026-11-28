// Échelle de classement continue (fonctions pures, testées) : pour tracer les LP dans le temps.
// Fer IV 0 PL = 0 ; chaque division vaut 100 ; Maître, Grand maître et Challenger partagent l'échelle des PL au-dessus de Diamant I.
const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
const DIVS = ["IV", "III", "II", "I"];
export const APEX_BASE = TIERS.length * 400; // 2 800 : Maître 0 PL

export function ladderPoints(tier: string, division: string, lp: number) {
  const t = TIERS.indexOf(tier);
  if (t >= 0) return t * 400 + Math.max(0, DIVS.indexOf(division)) * 100 + Math.min(100, lp);
  return APEX_BASE + lp; // Maître et au-dessus : PL sans plafond
}

/** Graduations de l'axe : une par rang (Fer, Bronze…, Maître). */
export function ladderTicks(min: number, max: number) {
  const labels = ["Fer", "Bronze", "Argent", "Or", "Platine", "Émeraude", "Diamant", "Maître"];
  return labels.map((label, i) => ({ label, value: i * 400 })).filter((t) => t.value >= min - 400 && t.value <= max + 1);
}

/** Écarts de PL entre deux photos successives (promotion et rétrogradation comprises). */
export function lpDeltas(snaps: { tier: string; division: string; lp: number; at: Date }[]) {
  return snaps.slice(1).map((s, i) => ({ at: s.at, delta: ladderPoints(s.tier, s.division, s.lp) - ladderPoints(snaps[i]!.tier, snaps[i]!.division, snaps[i]!.lp) }));
}
