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

import { absences, anchors, isDeadAt, teamFights } from "@/lib/riot/timelineFacts";

describe("précision des positions et moments sans mort", () => {
  const players10 = players;
  /** Partie : combat perdu 1–4 à 20:00 vers le dragon ; Ahri (p3) en vie au top ; dragon pris à 20:30. */
  function game() {
    const frames = [19, 20, 21].map((m) => ({
      timestamp: m * 60_000,
      events: [] as { type: string; timestamp: number; [k: string]: unknown }[],
      participantFrames: Object.fromEntries(puuids.map((_, i) => [String(i + 1), { position: i + 1 === 3 ? { x: 2000, y: 12500 } : { x: 9500, y: 4500 }, totalGold: 8000, level: 11 }])),
    }));
    const kill = (t: number, killer: number, victim: number) => ({ type: "CHAMPION_KILL", timestamp: t, position: { x: 9600 + victim * 10, y: 4500 }, killerId: killer, victimId: victim, assistingParticipantIds: [] });
    frames[1]!.events.push(kill(20 * 60_000, 6, 1), kill(20 * 60_000 + 3000, 7, 2), kill(20 * 60_000 + 6000, 9, 4), kill(20 * 60_000 + 8000, 1, 10), kill(20 * 60_000 + 9000, 6, 5));
    frames[1]!.events.push({ type: "ELITE_MONSTER_KILL", timestamp: 20 * 60_000 + 30_000, monsterType: "DRAGON", killerTeamId: 200, killerId: 7 });
    return compactTimeline({ metadata: { participants: puuids }, info: { frames } }, players10);
  }

  it("les kills servent de repères ; un joueur tué est mort pendant son temps de réapparition", () => {
    const ct = game();
    expect(anchors(ct, 1).some((a) => a.t === 20 * 60_000 && a.exact)).toBe(true); // victime : position exacte
    expect(isDeadAt(ct, 1, 20 * 60_000 + 5000)).toBe(true);
    expect(isDeadAt(ct, 1, 20 * 60_000 + 60_000)).toBe(false); // niveau 11 : ~35 s
    expect(positionAt(ct, 1, 20 * 60_000 + 10_000)).toEqual({ x: 400, y: 400 }); // à la fontaine pendant la mort
  });

  it("détecte le combat perdu loin du joueur, sans doublon avec le dragon qui suit", () => {
    const ct = game();
    expect(teamFights(ct, 100)).toHaveLength(1);
    const a = absences(ct, "p3");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "FIGHT", t: 20 * 60_000 });
    expect(a[0]!.title).toMatch(/Absent du combat perdu à 20:00 \(1–4\)/);
    expect(a[0]!.distance).toBeGreaterThan(8000);
    expect(a[0]!.travelSec).toBe(Math.round(a[0]!.distance / 380));
    expect(a[0]!.departT).toBe(20 * 60_000 - Math.min(25_000, a[0]!.travelSec * 1000 + 3000));
    expect(a[0]!.observations.join(" ")).toMatch(/il fallait partir vers 19:3\d/);
    expect(absences(ct, "p1")).toHaveLength(0); // impliqué dans le combat
  });
});

describe("réapparition", () => {
  it("après sa mort, le joueur repart de sa fontaine", () => {
    const frames = [0, 1].map((m) => ({
      timestamp: m * 60_000,
      events: [] as { type: string; timestamp: number; [k: string]: unknown }[],
      participantFrames: Object.fromEntries(puuids.map((_, i) => [String(i + 1), { position: { x: 9000, y: 9000 }, totalGold: 500, level: 1 }])),
    }));
    frames[0]!.events.push({ type: "CHAMPION_KILL", timestamp: 20_000, position: { x: 9000, y: 9000 }, killerId: 6, victimId: 1, assistingParticipantIds: [] });
    const ct = compactTimeline({ metadata: { participants: puuids }, info: { frames } }, players);
    expect(positionAt(ct, 1, 26_000)).toEqual({ x: 400, y: 400 }); // réapparu (6 s au niveau 1) à la fontaine bleue
    const p = positionAt(ct, 1, 43_000)!; // à mi-chemin entre la fontaine (26 s) et la minute suivante
    expect(p.x).toBeGreaterThan(4000);
    expect(p.x).toBeLessThan(5500);
  });
});

import { decisionPoint, type CompactTimeline } from "@/lib/riot/timelineFacts";

describe("instant de décision mesuré", () => {
  const base = (zedStart: { x: number; y: number }): CompactTimeline => ({
    v: 1,
    participants: [
      { pid: 1, puuid: "me", teamId: 100, champion: "Ahri" },
      { pid: 8, puuid: "zed", teamId: 200, champion: "Zed" },
    ],
    frames: [{ t: 830_000, pos: { "1": { x: 9000, y: 9500 }, "8": zedStart }, gold: {}, level: { "1": 11, "8": 11 } }],
    kills: [{ t: 840_000, pos: { x: 9000, y: 9500 }, killer: 8, victim: 1, assists: [] }],
    objectives: [],
    wards: [],
  });

  it("pause placée 1 s avant que l'ennemi arrive à portée", () => {
    const ct = base({ x: 12_000, y: 9500 }); // 3 000 unités à 13:50, au contact à 14:00
    const d = decisionPoint(ct, 1, ct.kills[0]!, [8]);
    expect(d.basis).toBe("approach");
    expect(d.enemy).toBe("Zed");
    expect(d.t).toBe(834_500); // passe sous 1 400 unités à 13:55,5 → décision à 13:54,5
    expect(d.distance).toBeLessThanOrEqual(1400);
  });

  it("bornée à 8 s avant la mort ; par défaut 2,5 s sans approche mesurable", () => {
    const close = base({ x: 9500, y: 9500 }); // déjà au contact 10 s avant
    expect(decisionPoint(close, 1, close.kills[0]!, [8])).toMatchObject({ basis: "already_close", t: 832_000, enemy: "Zed" });
    const ranged = base({ x: 30_000, y: 9500 }); // positions incohérentes : pas d'approche exploitable
    ranged.kills[0]!.pos = { x: 9000, y: 9500 };
    expect(decisionPoint(ranged, 1, ranged.kills[0]!, [])).toMatchObject({ basis: "default", t: 837_500 });
  });
});

import { departure } from "@/lib/riot/timelineFacts";
describe("heure de départ", () => {
  it("trajet / vitesse + 3 s de marge, borné entre 6 et 25 s", () => {
    expect(departure(3800, 600_000)).toEqual({ travelSec: 10, departT: 587_000 });
    expect(departure(500, 600_000).departT).toBe(594_000); // au moins 6 s
    expect(departure(20_000, 600_000).departT).toBe(575_000); // au plus 25 s
    expect(departure(3800, 4000).departT).toBe(0); // jamais avant le début
  });
});
