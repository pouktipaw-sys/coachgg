import { describe, expect, it } from "vitest";
import { compactTimeline, deathFacts, diagnoseDeath, myDeaths, positionAt, toMinimap } from "@/lib/riot/timelineFacts";

const puuids = Array.from({ length: 10 }, (_, i) => `p${i + 1}`);
const players = puuids.map((puuid, i) => ({ puuid, teamId: i < 5 ? 100 : 200, champion: ["Garen", "Vi", "Ahri", "Jinx", "Lulu", "Darius", "Lee Sin", "Zed", "Kai'Sa", "Nami"][i]! }));

/** Ahri (p3, équipe bleue) meurt à 14:00 dans la jungle rouge face à Zed + Lee Sin ; alliés loin ; dragon perdu 40 s après. */
function raw(extra: { tradedBack?: boolean; allyNear?: boolean; ward?: boolean } = {}) {
  const frame = (t: number) => ({
    timestamp: t,
    events: [] as { type: string; timestamp: number; [k: string]: unknown }[],
    participantFrames: Object.fromEntries(
      puuids.map((_, i) => {
        const pid = i + 1;
        const blue = pid <= 5;
        const pos = pid === 3 ? { x: 9000, y: 9500 } : pid === 2 && extra.allyNear ? { x: 8200, y: 8800 } : blue ? { x: 2000 + pid * 300, y: 2000 } : { x: 9500, y: 10000 };
        return [String(pid), { position: pos, totalGold: blue ? 5000 : 5500 }];
      }),
    ),
  });
  const f13 = frame(13 * 60_000);
  const f14 = frame(14 * 60_000);
  const f15 = frame(15 * 60_000);
  if (extra.ward) f13.events.push({ type: "WARD_PLACED", timestamp: 13 * 60_000 + 30_000, creatorId: 3 });
  f14.events.push({ type: "CHAMPION_KILL", timestamp: 14 * 60_000, position: { x: 9100, y: 9600 }, killerId: 8, victimId: 3, assistingParticipantIds: [7] });
  if (extra.tradedBack) f14.events.push({ type: "CHAMPION_KILL", timestamp: 14 * 60_000 + 5000, position: { x: 9100, y: 9600 }, killerId: 2, victimId: 8, assistingParticipantIds: [] });
  f14.events.push({ type: "ELITE_MONSTER_KILL", timestamp: 14 * 60_000 + 40_000, monsterType: "DRAGON", killerTeamId: 200, killerId: 7 });
  return { metadata: { participants: puuids }, info: { frames: [f13, f14, f15] } };
}

describe("timeline Riot : faits mesurés et diagnostic", () => {
  it("compacte la timeline, interpole les positions, convertit en coordonnées minimap", () => {
    const ct = compactTimeline(raw(), players);
    expect(ct.kills).toHaveLength(1);
    expect(ct.objectives).toEqual([{ t: 14 * 60_000 + 40_000, kind: "DRAGON", team: 200 }]);
    expect(positionAt(ct, 3, 13.5 * 60_000)).toEqual({ x: 9000, y: 9500 });
    expect(toMinimap({ x: 0, y: 0 })).toEqual({ x: 0, y: 1 }); // base bleue en bas à gauche
  });

  it("mort isolée avant un objectif : faits chiffrés et diagnostic « rotation »", () => {
    const ct = compactTimeline(raw(), players);
    const [d] = myDeaths(ct, "p3");
    const f = deathFacts(ct, "p3", d!);
    expect(f).toMatchObject({ killer: "Zed", enemiesInvolved: 2, wardsLast3min: 0, enemyHalf: true, tradedBack: false, goldDiff: -2500 });
    expect(f.alliesNear).toHaveLength(0);
    expect(f.objectiveLost).toMatchObject({ kind: "DRAGON", after: 40 });
    expect(f.safePoint.x).toBeLessThan(f.pos.x); // vers la base bleue
    const dx = diagnoseDeath(f);
    expect(dx).toMatchObject({ kind: "MISTAKE", category: "ROTATIONS" });
    expect(dx.title).toMatch(/40 s avant que l'ennemi prenne le dragon/);
    expect(dx.observations.join(" ")).toMatch(/Zed.*Lee Sin/);
  });

  it("échange : pas classé comme erreur ; vision et isolement selon les faits", () => {
    const traded = raw({ tradedBack: true });
    traded.info.frames[1]!.events = traded.info.frames[1]!.events.filter((e) => (e as { type: string }).type !== "ELITE_MONSTER_KILL");
    let ct = compactTimeline(traded, players);
    expect(diagnoseDeath(deathFacts(ct, "p3", myDeaths(ct, "p3")[0]!))).toMatchObject({ kind: "INTERESTING", category: "ENGAGEMENT" });

    const noObj = raw({ ward: true });
    noObj.info.frames[1]!.events = noObj.info.frames[1]!.events.filter((e) => (e as { type: string }).type !== "ELITE_MONSTER_KILL");
    ct = compactTimeline(noObj, players);
    const f = deathFacts(ct, "p3", myDeaths(ct, "p3")[0]!);
    expect(f.wardsLast3min).toBe(1);
    expect(diagnoseDeath(f).category).toBe("POSITIONING"); // isolé (2 ennemis, aucun allié)

    const withAlly = raw({ allyNear: true });
    withAlly.info.frames[1]!.events = withAlly.info.frames[1]!.events.filter((e) => (e as { type: string }).type !== "ELITE_MONSTER_KILL");
    ct = compactTimeline(withAlly, players);
    const g = deathFacts(ct, "p3", myDeaths(ct, "p3")[0]!);
    expect(g.alliesNear.map((a) => a.champion)).toEqual(["Vi"]);
    expect(diagnoseDeath(g).category).toBe("VISION"); // un allié présent, 2 contre 2, mais aucune balise côté adverse
  });
});
