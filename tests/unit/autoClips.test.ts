import { describe, expect, it } from "vitest";
import { autoClipsFrom } from "@/lib/analysis/autoClips";

const ev = (type: "grey_screen" | "high_activity", startMs: number, endMs: number) => ({ type, startMs, endMs });

describe("découpage automatique en clips", () => {
  const events = [ev("high_activity", 20_000, 26_000), ev("grey_screen", 60_000, 72_000), ev("high_activity", 55_000, 59_000), ev("grey_screen", 4_000, 9_000)];

  it("une mort → contexte avant + 3 s après, bornés à la vidéo", () => {
    const c = autoClipsFrom(events, 300_000, null, { deaths: true, fights: false, contextSec: 10 });
    expect(c.map((x) => [x.kind, x.startMs, x.endMs])).toEqual([
      ["DEATH", 0, 7_000],
      ["DEATH", 50_000, 63_000],
    ]);
    expect(c[1]!.title).toBe("Mort probable à 1:00");
  });

  it("combats en option, sans doublon avec une mort qui les recouvre", () => {
    const c = autoClipsFrom(events, 300_000, 30_000, { deaths: true, fights: true, contextSec: 10 });
    expect(c.map((x) => x.kind)).toEqual(["DEATH", "FIGHT", "DEATH"]);
    expect(c[1]).toMatchObject({ startMs: 15_000, endMs: 28_000, title: "Combat probable à 0:20" });
    expect(c[2]!.title).toBe("Mort probable à 1:00 (jeu 0:30)");
  });

  it("rien si les options sont désactivées", () => {
    expect(autoClipsFrom(events, 300_000, null, { deaths: false, fights: false, contextSec: 10 })).toEqual([]);
  });
});
