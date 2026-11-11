import { describe, expect, it } from "vitest";
import { badges, form, streak, type GameLite } from "@/lib/badges";

const now = new Date("2026-11-11T12:00:00Z");
const g = (over: Partial<GameLite> = {}): GameLite => ({
  win: true, kills: 5, deaths: 3, assists: 7, visionScore: 20, creepScore: 180, durationSec: 1800, score: 6, playedAt: new Date(now.getTime() - 86400_000), ...over,
});

describe("forme, séries et badges", () => {
  it("forme des 5 dernières parties et série en cours", () => {
    const games = [g(), g(), g(), g({ win: false }), g(), g()];
    expect(form(games)).toEqual(["V", "V", "V", "D", "V"]);
    expect(streak(games)).toEqual({ kind: "V", n: 3 });
    expect(streak([g({ win: false }), g({ win: false }), g()])).toEqual({ kind: "D", n: 2 });
    expect(streak([])).toBeNull();
  });

  it("attribue les badges uniquement quand les seuils sont atteints", () => {
    expect(badges([g(), g()], 0, now)).toEqual([]);
    const keys = badges(
      Array.from({ length: 10 }, (_, i) => g({ visionScore: 40, creepScore: 240, score: 7.5, deaths: i === 2 ? 0 : 3, kills: 6, assists: 6 })),
      6,
      now,
    ).map((b) => b.key);
    expect(keys).toEqual(["ON_FIRE", "MVP", "EAGLE_EYE", "FARMER", "UNTOUCHABLE", "CONSISTENT", "GRINDER"]);
    expect(badges([g()], 6, now).find((b) => b.key === "MVP")!.label).toBe("Légende du MVP");
  });
});
