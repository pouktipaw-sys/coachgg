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
        // Combat perdu 0–3 au dragon à 0:03 pendant que « Me » est loin, dans la jungle du haut
        { type: "CHAMPION_KILL", timestamp: 3_000, position: { x: 9800, y: 4400 }, killerId: 6, victimId: 2, assistingParticipantIds: [] },
        { type: "CHAMPION_KILL", timestamp: 4_000, position: { x: 9850, y: 4450 }, killerId: 7, victimId: 4, assistingParticipantIds: [] },
        { type: "CHAMPION_KILL", timestamp: 6_000, position: { x: 9900, y: 4400 }, killerId: 9, victimId: 5, assistingParticipantIds: [] },
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
    expect((m.timelineFacts as { kills: unknown[] }).kills).toHaveLength(5); // timeline compacte stockée

    const id = await uploadFile(u.id, "analysis.mp4");
    await prisma.recording.update({ where: { id }, data: { matchId: m.id, gameStartOffsetMs: 2000, minimapRegion: { x: 0.78, y: 0.66, w: 0.19, h: 0.33 } } });
    await requestAnalysis(id, 10);
    await drain();

    const recs = await prisma.recommendation.findMany({ where: { recordingId: id, status: "DRAFT" }, include: { annotations: true }, orderBy: { decisionMs: "asc" } });
    expect(recs.filter((r) => r.title.startsWith("Écran grisé"))).toHaveLength(0); // remplacée par la version mesurée
    const first = recs.find((r) => r.analysisVersion === "riot-timeline-1.0.0" && r.kind !== "MISSED_OPPORTUNITY" && r.decisionMs < 13_000)!;
    expect(first.title).toMatch(/avant que l'ennemi prenne le dragon/);
    expect(first).toMatchObject({ kind: "MISTAKE", category: "ROTATIONS", confidence: "MEDIUM" });
    // Zed déjà au contact 10 s avant la mort : pause 8 s avant (13 s − 8 s), et le texte le dit.
    expect(first.decisionMs).toBe(5000);
    expect((await prisma.observation.findMany({ where: { recommendationId: first.id } })).map((o) => o.text).join(" ")).toMatch(/Zed était déjà à moins de 1 400 unités/);
    const mm = first.annotations.filter((a) => a.space === "MINIMAP");
    const marks = mm.filter((a) => a.type !== "path");
    expect(marks.map((a) => `${a.type}:${a.style}`).sort()).toEqual(["arrow:alternative", "highlight:danger", "highlight:enemy", "highlight:enemy"]);
    // Reconstitution : trajets horodatés (toi + ennemis impliqués), au rythme de la vidéo, jusqu'à la mort
    const paths = mm.filter((a) => a.type === "path");
    expect(paths.map((a) => a.style).sort()).toEqual(["actual", "enemy", "enemy"]);
    const mine = paths.find((a) => a.style === "actual")!.geometry as { points: unknown[]; times: number[] };
    expect(mine.times.length).toBe(mine.points.length);
    expect(mine.times.at(-1)).toBeLessThanOrEqual(13_000);
    const second = recs.find((r) => r.analysisVersion === "riot-timeline-1.0.0" && r.kind !== "MISSED_OPPORTUNITY" && r.decisionMs > 15_000)!;
    expect(second.decisionMs).toBe(19_500);

    // Combat perdu à 0:03 (vidéo 5 s) loin du joueur : moment « rotation ratée » avec schéma minimap
    const missed = recs.find((r) => r.kind === "MISSED_OPPORTUNITY")!;
    expect(missed.title).toMatch(/Absent du combat perdu à 0:03 \(0–3\)/);
    // Départ nécessaire borné au début de la partie (0:00 de jeu = 2 s dans la vidéo)
    expect(missed.decisionMs).toBe(2000);
    expect(missed.annotations.map((a) => `${a.type}:${a.style}`).sort()).toEqual(["arrow:alternative", "highlight:actual", "path:actual", "zone:danger"]);
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    const step = (job.result as { steps: { name: string; note?: string }[] }).steps.find((s) => s.name.startsWith("Timeline Riot"))!;
    expect(step.note).toMatch(/2 mort\(s\) réelle\(s\).*1 confirmée.*1 moment\(s\) sans mort/);
    const syncNote = (job.result as { steps: { name: string; note?: string }[] }).steps.find((s) => s.name === "Liaison et synchronisation automatiques")!.note;
    expect(syncNote).toMatch(/Synchro vérifiée : 1 mort\(s\) concordent/);
    expect(await prisma.clip.count({ where: { recordingId: id, kind: "MISSED_OPPORTUNITY" } })).toBe(1);

    // Récap monté de bout en bout (reconstitution comprise), moments qui se chevauchent fusionnés
    const recap = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "RENDER_RECAP" } });
    expect(recap.status).toBe("SUCCEEDED");
    const r = recap.result as { moments: number; segments: number };
    expect(r.moments).toBe(3);
    expect(r.segments).toBeLessThan(r.moments);
    const after = await prisma.recording.findUniqueOrThrow({ where: { id } });
    expect(after.recapStatus).toBe("READY");
    const { execFileSync } = await import("node:child_process");
    const { storage } = await import("@/server/storage");
    const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", storage().localPath(after.recapKey!)]).toString());
    expect(dur).toBeGreaterThan(10);
    const clips = await prisma.clip.findMany({ where: { recordingId: id, kind: "DEATH" }, orderBy: { startMs: "asc" } });
    expect(clips.length).toBe(2); // la mort non vue à l'image a aussi son clip
  }, 240_000);
  it("erreurs sans mort : retour raté, retour avant le dragon, sbires perdus — clips, pastilles, bilan de voie", async () => {
    // Vidéo de 5 min (petite résolution) ; décalage 2 s. Partie de 15 min (bilan de voie à 10 et 15 min).
    if (!existsSync(fixture("five-min.mp4")))
      execSync("ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=320x180:rate=5 -t 300 -c:v libx264 -pix_fmt yuv420p five-min.mp4", { cwd: fixture("") });
    const u = await makeUser("Mac");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Me", tagLine: "EUW", platform: "EUW1", puuid: "ME" } });
    const csPerMin = (pid: number, m: number) => (pid === 1 ? (m === 4 || m === 5 ? 1 : 8) : pid === 6 ? 8 : 6);
    const pf = (m: number) => Object.fromEntries(puuids.map((_, i) => {
      const pid = i + 1;
      let cs = 0;
      for (let k = 1; k <= m; k++) cs += csPerMin(pid, k);
      return [String(pid), { position: pid === 1 ? { x: 3000, y: 12000 } : { x: 9000, y: 9000 }, totalGold: 500 + m * 400, level: 1 + m, currentGold: pid === 1 && (m === 3 || m === 4) ? 1700 + m * 100 : 300, minionsKilled: cs, jungleMinionsKilled: 0 }];
    }));
    // Achat à 2:05, puis retour à la base à 3:30 juste avant le dragon pris par l'ennemi à 4:20 (le joueur est loin, en base).
    const tl4 = { metadata: { matchId: "EUW1_555", participants: puuids }, info: { frames: Array.from({ length: 16 }, (_, m) => m).map((m) => ({
      timestamp: m * 60_000,
      participantFrames: pf(m),
      events: m === 2 ? [{ type: "ITEM_PURCHASED", timestamp: 2 * 60_000 + 5000, participantId: 1 }] :
        m === 3 ? [{ type: "ITEM_PURCHASED", timestamp: 3 * 60_000 + 30_000, participantId: 1 }] :
        m === 4 ? [{ type: "ELITE_MONSTER_KILL", timestamp: 4 * 60_000 + 20_000, monsterType: "DRAGON", killerTeamId: 200, killerId: 7 }] : [],
    })) } };
    const m5 = { ...match, metadata: { matchId: "EUW1_555" }, info: { ...match.info, gameDuration: 930 } };
    const client = new RiotClient("k", async (url: string) => {
      if (url.includes("/EUW1_555/timeline")) return new Response(JSON.stringify(tl4), { status: 200 });
      if (url.includes("/ids?")) return new Response(JSON.stringify(["EUW1_555"]), { status: 200 });
      if (url.includes("/matches/EUW1_555")) return new Response(JSON.stringify(m5), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    await importRecentMatches(u.id, 1, client);
    const mt = await prisma.match.findFirstOrThrow({ where: { riotMatchId: "EUW1_555" } });
    expect((mt.timelineFacts as { v: number }).v).toBe(2);
    const id = await uploadFile(u.id, "five-min.mp4", { process: false });
    await drain();
    await prisma.recording.update({ where: { id }, data: { matchId: mt.id, gameStartOffsetMs: 2000, minimapRegion: { x: 0.78, y: 0.66, w: 0.19, h: 0.33 } } });
    await requestAnalysis(id, 10);
    await drain();

    const recs = await prisma.recommendation.findMany({ where: { recordingId: id, analysisVersion: "riot-timeline-1.0.0" }, orderBy: { decisionMs: "asc" } });
    const flags = (r: (typeof recs)[number]) => (r.autoEvidence as { flags: string[] }).flags;
    const cs = recs.find((r) => flags(r).includes("cs_drop"))!;
    expect(cs.title).toBe("Sbires perdus de 3:00 à 5:00 (environ −14)");
    expect(cs).toMatchObject({ kind: "MISTAKE", category: "RESOURCES", decisionMs: 182_000 });
    const bad = recs.find((r) => flags(r).includes("bad_back"))!;
    expect(bad.title).toBe("Retour à la base 50 s avant que l'ennemi prenne le dragon (4:20)");
    expect(bad.decisionMs).toBe(2000 + 3 * 60_000 + 20_000);
    expect(recs.some((r) => flags(r).includes("missed_back"))).toBe(false); // passage à la boutique à 3:30 : pas un retour « raté »
    const anns = (await prisma.recommendation.findUniqueOrThrow({ where: { id: bad.id }, include: { annotations: true } })).annotations;
    expect(anns.map((a) => `${a.type}:${a.style}`).sort()).toEqual(["arrow:alternative", "highlight:actual", "zone:danger"]);
    expect(await prisma.clip.count({ where: { recordingId: id, kind: "MISTAKE" } })).toBe(2);
    const report = (await prisma.recording.findUniqueOrThrow({ where: { id } })).gameReport as { patterns: string[]; summary: string };
    expect(report.patterns[0]).toBe("À 15 min face à Darius : −14 sbires, 0 or.");
    // Le dragon n'apparaît qu'une fois : comme « retour au mauvais moment », pas aussi comme « pris pendant que tu étais loin ».
    expect(recs.filter((r) => /dragon/i.test(r.title))).toHaveLength(1);
    expect(report.summary).toMatch(/erreur\(s\) sans mort/);
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" }, orderBy: { createdAt: "desc" } });
    const step = (job.result as { steps: { name: string; note?: string }[] }).steps.find((s) => s.name.startsWith("Timeline Riot"))!;
    expect(step.note).toMatch(/0 retour\(s\) raté\(s\), 1 retour\(s\) au mauvais moment, 1 période\(s\) de sbires perdus/);
  }, 400_000);

  it("liaison automatique sans date dans le nom : date de modification du fichier", async () => {
    if (!existsSync(fixture("two-deaths.mp4")))
      execSync(
        "ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 50 -vf \"hue=s=0:enable='between(t,13,18)+between(t,33,38)'\" -c:v libx264 -pix_fmt yuv420p two-deaths.mp4",
        { cwd: fixture("") },
      );
    copyFileSync(fixture("two-deaths.mp4"), fixture("ma game renommee.mp4"));
    const u = await makeUser("Dan");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Me", tagLine: "EUW", platform: "EUW1", puuid: "ME" } });
    const tl3 = structuredClone(timeline);
    (tl3.info.frames[0]!.events as object[]).splice(0, Infinity,
      { type: "CHAMPION_KILL", timestamp: 11_000, position: { x: 9100, y: 9600 }, killerId: 8, victimId: 1, assistingParticipantIds: [7] },
      { type: "CHAMPION_KILL", timestamp: 31_000, position: { x: 8000, y: 8000 }, killerId: 6, victimId: 1, assistingParticipantIds: [9] },
    );
    const client = new RiotClient("k", async (url: string) => {
      if (url.includes("/EUW1_999/timeline")) return new Response(JSON.stringify({ ...tl3, metadata: { matchId: "EUW1_999", participants: puuids } }), { status: 200 });
      if (url.includes("/ids?")) return new Response(JSON.stringify(["EUW1_999"]), { status: 200 });
      if (url.includes("/matches/EUW1_999")) return new Response(JSON.stringify({ ...match, metadata: { matchId: "EUW1_999" } }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    await importRecentMatches(u.id, 1, client);
    // Fichier enregistré jusqu'à la fin de la partie (+ 1 min), puis renommé : seule la date de modification reste.
    const id = await uploadFile(u.id, "ma game renommee.mp4", { fileModifiedAt: new Date(1_760_001_860_000) });
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id } });
    expect(rec.matchId).toBe((await prisma.match.findFirstOrThrow({ where: { riotMatchId: "EUW1_999" } })).id);
    expect(Math.abs(rec.gameStartOffsetMs! - 2000)).toBeLessThanOrEqual(150);
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    const note = (job.result as { steps: { name: string; note?: string }[] }).steps.find((s) => s.name === "Liaison et synchronisation automatiques")!.note;
    expect(note).toMatch(/liée à la partie.*date de modification du fichier/);
  }, 300_000);

  it("vidéo sans partie Riot : la liaison explique pourquoi elle échoue", async () => {
    const u = await makeUser("Eve");
    const id = await uploadFile(u.id, "analysis.mp4", { fileModifiedAt: new Date() });
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    const steps = (job.result as { steps: { name: string; note?: string }[] }).steps;
    expect(steps.find((s) => s.name === "Liaison et synchronisation automatiques")!.note).toMatch(/aucune partie Riot importée/);
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
    (tl2.info.frames[0]!.events as { timestamp: number; type: string }[]).splice(0, Infinity,
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
    expect(Math.abs(rec.gameStartOffsetMs! - 2000)).toBeLessThanOrEqual(150); // début des écrans grisés affiné à 15 images/s
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    const note = (job.result as { steps: { name: string; note?: string }[] }).steps.find((s) => s.name === "Liaison et synchronisation automatiques")!.note;
    expect(note).toMatch(/liée à la partie.*Synchronisée automatiquement : 2 mort/);
    expect(await prisma.recommendation.count({ where: { recordingId: id, analysisVersion: "riot-timeline-1.0.0" } })).toBe(2);
    // Bilan expert : les deux morts sont « isolé face à 2 ennemis » → erreur récurrente en tête
    const report = (await prisma.recording.findUniqueOrThrow({ where: { id } })).gameReport as { patterns: string[]; priorities: { title: string }[] };
    expect(report.patterns[0]).toBe("2 morts isolé face à plusieurs ennemis");
    expect(report.priorities[0]!.title).toBe("Placement");
  }, 240_000);
  it("synchro réglée fausse : corrigée avec 3 morts concordantes, simple avertissement avec 2", async () => {
    // Vidéo de 70 s avec trois écrans grisés (13, 33, 53 s) ; morts de la partie à 0:11, 0:31, 0:51 → bon décalage : 2 s.
    if (!existsSync(fixture("three-deaths.mp4")))
      execSync(
        "ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 70 -vf \"hue=s=0:enable='between(t,13,18)+between(t,33,38)+between(t,53,58)'\" -c:v libx264 -pix_fmt yuv420p three-deaths.mp4",
        { cwd: fixture("") },
      );
    const scenario = async (name: string, matchId: string, deaths: number[], video: string, wrongOffset: number) => {
      const u = await makeUser(name);
      await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Me", tagLine: "EUW", platform: "EUW1", puuid: "ME" } });
      const tl = structuredClone(timeline);
      tl.metadata.matchId = matchId;
      (tl.info.frames[0]!.events as object[]).splice(0, Infinity, ...deaths.map((t, i) => ({ type: "CHAMPION_KILL", timestamp: t, position: { x: 7000 + i * 500, y: 7000 }, killerId: 6, victimId: 1, assistingParticipantIds: [] })));
      const client = new RiotClient("k", async (url: string) => {
        if (url.includes(`/${matchId}/timeline`)) return new Response(JSON.stringify(tl), { status: 200 });
        if (url.includes("/ids?")) return new Response(JSON.stringify([matchId]), { status: 200 });
        if (url.includes(`/matches/${matchId}`)) return new Response(JSON.stringify({ ...match, metadata: { matchId } }), { status: 200 });
        return new Response("{}", { status: 404 });
      });
      await importRecentMatches(u.id, 1, client);
      const m = await prisma.match.findFirstOrThrow({ where: { riotMatchId: matchId } });
      const id = await uploadFile(u.id, video);
      await prisma.recording.update({ where: { id }, data: { matchId: m.id, gameStartOffsetMs: wrongOffset } });
      await requestAnalysis(id, 10);
      await drain();
      const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
      const note = (job.result as { steps: { name: string; note?: string }[] }).steps.find((s) => s.name === "Liaison et synchronisation automatiques")!.note!;
      return { rec: await prisma.recording.findUniqueOrThrow({ where: { id } }), note };
    };
    const fixed = await scenario("Cid", "EUW1_901", [11_000, 31_000, 51_000], "three-deaths.mp4", 22_000);
    expect(Math.abs(fixed.rec.gameStartOffsetMs! - 2000)).toBeLessThanOrEqual(150);
    expect(fixed.note).toMatch(/décalée de 20,\d s : corrigée automatiquement \(3 morts concordent/);

    const warned = await scenario("Dee", "EUW1_902", [11_000, 31_000], "two-deaths.mp4", 12_000);
    expect(warned.rec.gameStartOffsetMs).toBe(12_000); // pas de correction avec seulement 2 morts
    expect(warned.note).toMatch(/semble décalée d'environ 10,\d s/);
  }, 400_000);
  it("écran grisé sans mort réelle dans la timeline : fausse détection écartée (ni moment ni clip)", async () => {
    // two-deaths.mp4 : écrans grisés à 13 s et 33 s ; la partie ne compte qu'une mort (0:11 → 13 s avec 2 s de décalage).
    const u = await makeUser("Eve");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Me", tagLine: "EUW", platform: "EUW1", puuid: "ME" } });
    const tl = structuredClone(timeline);
    tl.metadata.matchId = "EUW1_903";
    (tl.info.frames[0]!.events as object[]).splice(0, Infinity, { type: "CHAMPION_KILL", timestamp: 11_000, position: { x: 7000, y: 7000 }, killerId: 6, victimId: 1, assistingParticipantIds: [] });
    const client = new RiotClient("k", async (url: string) => {
      if (url.includes("/EUW1_903/timeline")) return new Response(JSON.stringify(tl), { status: 200 });
      if (url.includes("/ids?")) return new Response(JSON.stringify(["EUW1_903"]), { status: 200 });
      if (url.includes("/matches/EUW1_903")) return new Response(JSON.stringify({ ...match, metadata: { matchId: "EUW1_903" } }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    await importRecentMatches(u.id, 1, client);
    const m = await prisma.match.findFirstOrThrow({ where: { riotMatchId: "EUW1_903" } });
    const id = await uploadFile(u.id, "two-deaths.mp4");
    await prisma.recording.update({ where: { id }, data: { matchId: m.id, gameStartOffsetMs: 2000 } });
    await requestAnalysis(id, 10);
    await drain();
    const recs = await prisma.recommendation.findMany({ where: { recordingId: id, status: "DRAFT" } });
    expect(recs.filter((r) => r.title.startsWith("Écran grisé"))).toHaveLength(0);
    expect(recs.filter((r) => r.analysisVersion === "riot-timeline-1.0.0")).toHaveLength(1);
    expect(await prisma.clip.count({ where: { recordingId: id, kind: "DEATH" } })).toBe(1);
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    const note = (job.result as { steps: { name: string; note?: string }[] }).steps.find((s) => s.name.startsWith("Timeline Riot"))!.note;
    expect(note).toMatch(/1 fausse\(s\) détection\(s\) d'écran grisé écartée/);
    // Les détections brutes restent enregistrées (mesure de précision)
    expect((job.result as { detections: { type: string }[] }).detections.filter((d) => d.type === "grey_screen")).toHaveLength(2);
  }, 300_000);
});

describe.skipIf(!available)("précision de l'analyse (banc d'essai)", () => {
  it("minimap détectée et enregistrée automatiquement, mort calée à l'image près", async () => {
    const { env } = await import("@/lib/env");
    const dir = fixture("bench");
    if (!existsSync(`${dir}/00-test-court.mp4`)) execSync(`"${env.pythonBin}" analysis/bench/make_corpus.py "${dir}" 00-test-court`);
    copyFileSync(`${dir}/00-test-court.mp4`, fixture("bench-court.mp4"));
    const truth = JSON.parse(require("node:fs").readFileSync(`${dir}/labels.json`, "utf8"))["00-test-court.mp4"] as { deaths: number[]; minimap: { x: number; y: number; w: number; h: number } };
    const u = await makeUser("Bench");
    const id = await uploadFile(u.id, "bench-court.mp4"); // aucune zone minimap réglée
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id } });
    const mm = rec.minimapRegion as { x: number; y: number; w: number; h: number };
    expect(mm).not.toBeNull();
    for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(mm[k] - truth.minimap[k])).toBeLessThan(0.004); // ≤ 3 px en 720p
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    const steps = (job.result as { steps: { name: string; note?: string }[]; detections?: { type: string; startMs: number }[] }).steps;
    expect(steps.find((s) => s.name.startsWith("Extraction"))!.note).toMatch(/Zone minimap détectée automatiquement/);
    const greys = (await prisma.recommendation.findMany({ where: { recordingId: id }, select: { autoEvidence: true } }))
      .map((r) => r.autoEvidence as { type?: string; startMs?: number; eventVideoMs?: number })
      .filter((e) => e.type === "grey_screen");
    expect(greys.length).toBe(1);
  }, 300_000);
});
