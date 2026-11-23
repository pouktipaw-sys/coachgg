// Changements chiffrés d'un champion entre deux versions des données officielles (fonction pure, testée) :
// statistiques de base et, pour chaque sort, récupération, coût et portée. Les textes ne sont pas comparés.
type Champ = { name: string; stats?: Record<string, number>; spells: { name: string; cooldownBurn?: string; costBurn?: string; rangeBurn?: string }[] };

const STAT_FR: Record<string, string> = {
  hp: "PV de base", hpperlevel: "PV par niveau", mp: "Mana de base", mpperlevel: "Mana par niveau", movespeed: "Vitesse de déplacement",
  armor: "Armure", armorperlevel: "Armure par niveau", spellblock: "Résistance magique", spellblockperlevel: "Résistance magique par niveau",
  attackrange: "Portée d'attaque", hpregen: "Régénération de PV", mpregen: "Régénération de mana", attackdamage: "Dégâts d'attaque",
  attackdamageperlevel: "Dégâts d'attaque par niveau", attackspeed: "Vitesse d'attaque", attackspeedperlevel: "Vitesse d'attaque par niveau",
};
const KEYS = ["Q", "W", "E", "R"];
const fr = (x: number | string) => String(x).replace(".", ",");

export function championChanges(before: Champ, after: Champ): string[] {
  const out: string[] = [];
  for (const [k, label] of Object.entries(STAT_FR)) {
    const a = before.stats?.[k];
    const b = after.stats?.[k];
    if (a != null && b != null && Math.abs(a - b) > 1e-9) out.push(`${label} : ${fr(a)} → ${fr(b)}`);
  }
  after.spells.forEach((sp, i) => {
    const old = before.spells[i];
    if (!old) return;
    const parts: [string, string | undefined, string | undefined, string][] = [
      ["récupération", old.cooldownBurn, sp.cooldownBurn, " s"],
      ["coût", old.costBurn, sp.costBurn, ""],
      ["portée", old.rangeBurn, sp.rangeBurn, ""],
    ];
    for (const [label, a, b, unit] of parts) if (a && b && a !== b && a !== "0" && b !== "0") out.push(`${KEYS[i]} (${sp.name}) : ${label} ${fr(a)} → ${fr(b)}${unit}`);
  });
  return out;
}
