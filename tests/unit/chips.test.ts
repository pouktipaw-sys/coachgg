import { describe, expect, it } from "vitest";
import { momentChips } from "@/lib/analysis/chips";

describe("pastilles de faits", () => {
  it("résume une mort mesurée en pastilles colorées", () => {
    const chips = momentChips({
      type: "riot_death",
      facts: { enemiesInvolved: 2, alliesNear: [], levels: { me: 7, enemies: 9 }, unspentGold: 1850, wardsLast3min: 0, enemyHalf: true, objectiveLost: { label: "le dragon", after: 40 }, deathTimerSec: 30 },
    });
    expect(chips).toEqual([
      { text: "1 contre 2", tone: "bad" },
      { text: "Niv. 7 vs 9", tone: "bad" },
      { text: "1 850 or en poche", tone: "bad" },
      { text: "Sans balise", tone: "bad" },
      { text: "Dragon perdu (+40 s)", tone: "bad" },
      { text: "30 s mort", tone: "warn" },
    ]);
  });
  it("échange, objectif imminent, avance de niveau ; absence ; rien sans faits", () => {
    expect(momentChips({ type: "riot_death", facts: { enemiesInvolved: 1, alliesNear: [{}], levels: { me: 10, enemies: 8 }, tradedBack: true, objectivesUp: [{ kind: "BARON", inSec: 30 }] } }).map((c) => c.text)).toEqual([
      "2 contre 1",
      "Niv. 10 vs 8",
      "Nashor dans 30 s",
      "Échange",
    ]);
    expect(momentChips({ type: "riot_absence", absence: { kind: "FIGHT", distance: 6430 } }).map((c) => c.text)).toEqual(["À 6 400 unités", "Combat perdu sans toi"]);
    expect(momentChips(null)).toEqual([]);
  });
});
