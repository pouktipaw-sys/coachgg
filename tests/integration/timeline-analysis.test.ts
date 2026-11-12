// Analyse précise avec la timeline Riot : vraie partie importée (serveur simulé), vidéo synchronisée.
// La vidéo de test a un écran grisé à 13 s ; la timeline place une mort à 0:11 de jeu (offset 2 s → 13 s)
// et une seconde à 0:20 (22 s dans la vidéo) que l'image ne détecte pas.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { RiotClient, type RiotMatch } from "@/server/riot/client";
import { importRecentMatches } from "@/server/riot/import";
import { requestAnalysis } from "@/server/analysis/job";
import { analyzerAvailable } from "@/server/analysis/runner";
import { drain } from "@/worker/index";
import { fixture, makeUser, uploadFile } from "./helpers";

const available = (await analyzerAvailable()).ok;
const puuids = ["ME", ...Array.from({ length: 9 }, (_, i) => `P${i + 2}`)];
const champs = ["Ahri", "Vi", "Garen", "Jinx", "Lulu", "Darius", "Lee Sin", "Zed", "Kai'Sa", "Nami"];

const match: RiotMatch = {
  metadata: { matchId: "EUW1_777" },
  info: {
    gameCreation: 1_760_000_000_000, gameStartTimestamp: 1_760_000_000_000, gameDuration: 1800, gameEndTimestamp: 1_760_001_800_000,
    gameVersion: "15.20.1", queueId: 420, platformId: "EUW1",
    participants: puuids.map((puuid, i) => ({
      puuid, riotIdGameName: i === 0 ? "Me" : `Player${i}`, riotIdTagline: "EUW", championName: champs[i]!, teamPosition: ["MIDDLE", "JUNGLE", "TOP", "BOTTOM", "UTILITY"][i % 5],
      teamId: i < 5 ? 100 : 200, win: i >= 5, kills: 3, deaths: 5, assists: 4, totalMinionsKilled: 150, neutralMinionsKilled: 0, goldEarned: 9000,
      totalDamageDealtToChampions: 15000, damageDealtToObjectives: 3000, visionScore: 15, wardsPlaced: 5, wardsKilled: 1, visionWardsBoughtInGame: 1,
    })),
  },
};
const frame = (t: number, events: object[]) => ({
  timestamp: t,
  events,
  participantFrames: Object.fromEntries(puuids.map((_, i) => [String(i + 1), { position: i === 0 ? { x: 9000, y: 9500 } : i < 5 ? { x: 1500, y: 1500 } : { x: 9500, y: 10000 }, totalGold: 500 }])),
});
const timeline = {
  metadata: { matchId: "EUW1_777", participants: puuids },
  info: {
    frames: [
      frame(0, [
        { type: "CHAMPION_KILL", timestamp: 11_000, position: { x: 9100, y: 9600 }, killerId: 8, victimId: 1, assistingParticipantIds: [7] },
        { type: "ELITE_MONSTER_KILL", timestamp: 40_000, monsterType: "DRAGON", killerTeamId: 200, killerId: 7 },
        { type: "CHAMPION_KILL", timestamp: 20_000, position: { x: 7000, y: 7000 }, killerId: 6, victimId: 1, assistingParticipantIds: [] },
      ]),
      frame(60_000, []),
    ],
  },
};

describe.skipIf(!available)("analyse avec la timeline Riot", () => {
  it("vraies morts : diagnostic chiffré, schéma minimap, fusion avec la détection d'image, clip pour la mort non détectée", async () => {
    const u = await makeUser("Ana");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Me", tagLine: "EUW", platform: "EUW1", puuid: "ME" } });
    const client = new RiotClient("k", async (url: string) => {
      if (url.includes("/EUW1_777/timeline")) return new Response(JSON.stringify(timeline), { status: 200 });
      if (url.includes("/ids?")) return new Response(JSON.stringify(["EUW1_777"]), { status: 200 });
      if (url.includes("/matches/EUW1_777")) return new Response(JSON.stringify(match), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    await importRecentMatches(u.id, 1, client);
    const m = await prisma.match.findFirstOrThrow({ where: { riotMatchId: "EUW1_777" } });
    expect((m.timelineFacts as { kills: unknown[] }).kills).toHaveLength(2); // timeline compacte stockée

    const id = await uploadFile(u.id, "analysis.mp4");
    await prisma.recording.update({ where: { id }, data: { matchId: m.id, gameStartOffsetMs: 2000, minimapRegion: { x: 0.78, y: 0.66, w: 0.19, h: 0.33 } } });
    await requestAnalysis(id, 10);
    await drain();

    const recs = await prisma.recommendation.findMany({ where: { recordingId: id, status: "DRAFT" }, include: { annotations: true }, orderBy: { decisionMs: "asc" } });
    expect(recs.filter((r) => r.title.startsWith("Écran grisé"))).toHaveLength(0); // remplacée par la version mesurée
    const first = recs.find((r) => r.analysisVersion === "riot-timeline-1.0.0" && r.decisionMs < 13_000)!;
    expect(first.title).toMatch(/avant que l'ennemi prenne le dragon/);
    expect(first).toMatchObject({ kind: "MISTAKE", category: "ROTATIONS", confidence: "MEDIUM" });
    expect(first.decisionMs).toBe(10_500); // 2,5 s avant la mort à 13 s
    const mm = first.annotations.filter((a) => a.space === "MINIMAP");
    expect(mm.map((a) => `${a.type}:${a.style}`).sort()).toEqual(["arrow:alternative", "highlight:danger", "highlight:enemy", "highlight:enemy"]);
    const second = recs.find((r) => r.analysisVersion === "riot-timeline-1.0.0" && r.decisionMs > 15_000)!;
    expect(second.decisionMs).toBe(19_500);

    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    const step = (job.result as { steps: { name: string; note?: string }[] }).steps.find((s) => s.name.startsWith("Timeline Riot"))!;
    expect(step.note).toMatch(/2 mort\(s\) réelle\(s\).*1 confirmée/);
    const clips = await prisma.clip.findMany({ where: { recordingId: id, kind: "DEATH" }, orderBy: { startMs: "asc" } });
    expect(clips.length).toBe(2); // la mort non vue à l'image a aussi son clip
  }, 240_000);
  it("liaison et synchronisation automatiques : date du nom de fichier + alignement de 2 morts", async () => {
    // Vidéo de 50 s avec deux écrans grisés (13-18 s et 33-38 s) ; partie : morts à 0:11 et 0:31 → décalage 2 s.
    if (!existsSync(fixture("two-deaths.mp4")))
      execSync(
        "ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 50 -vf \"hue=s=0:enable='between(t,13,18)+between(t,33,38)'\" -c:v libx264 -pix_fmt yuv420p two-deaths.mp4",
        { cwd: fixture("") },
      );
    const start = new Date(1_760_000_000_000 + 60_000); // une minute après le début de la partie (heure locale)
    const p2 = (n: number) => String(n).padStart(2, "0");
    const name = `League of Legends (TM) Client ${start.getFullYear()}-${p2(start.getMonth() + 1)}-${p2(start.getDate())} ${p2(start.getHours())}-${p2(start.getMinutes())}-${p2(start.getSeconds())}.mp4`;
    copyFileSync(fixture("two-deaths.mp4"), fixture(name));

    const u = await makeUser("Bea");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Me", tagLine: "EUW", platform: "EUW1", puuid: "ME" } });
    const tl2 = structuredClone(timeline);
    (tl2.info.frames[0]!.events as { timestamp: number; type: string }[]).splice(0, 3,
      { type: "CHAMPION_KILL", timestamp: 11_000, position: { x: 9100, y: 9600 }, killerId: 8, victimId: 1, assistingParticipantIds: [7] } as never,
      { type: "CHAMPION_KILL", timestamp: 31_000, position: { x: 8000, y: 8000 }, killerId: 6, victimId: 1, assistingParticipantIds: [9] } as never,
    );
    const client = new RiotClient("k", async (url: string) => {
      if (url.includes("/EUW1_888/timeline")) return new Response(JSON.stringify({ ...tl2, metadata: { matchId: "EUW1_888", participants: puuids } }), { status: 200 });
      if (url.includes("/ids?")) return new Response(JSON.stringify(["EUW1_888"]), { status: 200 });
      if (url.includes("/matches/EUW1_888")) return new Response(JSON.stringify({ ...match, metadata: { matchId: "EUW1_888" } }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    await importRecentMatches(u.id, 1, client);
    const id = await uploadFile(u.id, name); // traitement puis analyse automatique, sans lien ni synchro manuels

    const rec = await prisma.recording.findUniqueOrThrow({ where: { id } });
    const m = await prisma.match.findFirstOrThrow({ where: { riotMatchId: "EUW1_888" } });
    expect(rec.matchId).toBe(m.id);
    expect(Math.abs(rec.gameStartOffsetMs! - 2000)).toBeLessThanOrEqual(700);
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    const note = (job.result as { steps: { name: string; note?: string }[] }).steps.find((s) => s.name === "Liaison et synchronisation automatiques")!.note;
    expect(note).toMatch(/liée à la partie.*Synchronisée automatiquement : 2 mort/);
    expect(await prisma.recommendation.count({ where: { recordingId: id, analysisVersion: "riot-timeline-1.0.0" } })).toBe(2);
  }, 240_000);
});
