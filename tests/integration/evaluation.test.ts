import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addGroundTruth, deleteGroundTruth, evaluateRecording, evaluationSummary, importRiotDeaths, listGroundTruth } from "@/server/analysis/evaluation";
import { analyzerAvailable } from "@/server/analysis/runner";
import { RiotClient } from "@/server/riot/client";
import { makeUser, uploadFile } from "./helpers";

const available = (await analyzerAvailable()).ok;

describe("vérité terrain (sans analyse)", () => {
  it("marque, refuse les doublons et les instants hors vidéo, réservé au propriétaire", async () => {
    const u = await makeUser("Ana");
    const other = await makeUser("Eve");
    const id = await uploadFile(u.id, "sample.webm", { process: true });
    const ev = await addGroundTruth(u.id, id, 3000);
    await expect(addGroundTruth(u.id, id, 3500)).rejects.toMatchObject({ status: 409 });
    await expect(addGroundTruth(u.id, id, 999_999)).rejects.toThrow(/hors/);
    await expect(addGroundTruth(other.id, id, 1000)).rejects.toMatchObject({ status: 404 });
    await expect(listGroundTruth(other.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteGroundTruth(other.id, ev.id)).rejects.toMatchObject({ status: 404 });
    await deleteGroundTruth(u.id, ev.id);
    expect(await listGroundTruth(u.id, id)).toHaveLength(0);
  });

  it("importe les morts depuis la timeline Riot (serveur simulé) en temps vidéo", async () => {
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "sample.mp4");
    const match = await prisma.match.create({
      data: {
        source: "RIOT_API",
        riotMatchId: "EUW1_42",
        durationSec: 1800,
        createdById: u.id,
        participants: { create: { userId: u.id, puuid: "P-ANA", championName: "Ahri", teamSide: 100, win: true } },
      },
    });
    await expect(importRiotDeaths(u.id, id, new RiotClient("k"))).rejects.toThrow(/liée à un match/);
    await prisma.recording.update({ where: { id }, data: { matchId: match.id } });
    await expect(importRiotDeaths(u.id, id, new RiotClient("k"))).rejects.toThrow(/Synchronisez/);
    await prisma.recording.update({ where: { id }, data: { gameStartOffsetMs: 2000 } });
    const timeline = {
      metadata: { matchId: "EUW1_42", participants: ["x", "P-ANA"] },
      info: { frames: [{ timestamp: 0, events: [{ type: "CHAMPION_KILL", timestamp: 5000, victimId: 2 }, { type: "CHAMPION_KILL", timestamp: 9000, victimId: 1 }, { type: "CHAMPION_KILL", timestamp: 600_000, victimId: 2 }] }] },
    };
    const calls: string[] = [];
    const client = new RiotClient("k", async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(timeline), { status: 200 });
    });
    expect(await importRiotDeaths(u.id, id, client)).toEqual({ imported: 1 }); // la mort à 10 min dépasse la vidéo de 20 s
    expect(calls[0]).toBe("https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_42/timeline");
    const truths = await listGroundTruth(u.id, id);
    expect(truths.map((t) => [t.videoMs, t.source])).toEqual([[7000, "RIOT_TIMELINE"]]);
    // réimport idempotent
    await importRiotDeaths(u.id, id, client);
    expect(await listGroundTruth(u.id, id)).toHaveLength(1);
  });
});

describe.skipIf(!available)("évaluation de l'analyse réelle", () => {
  it("indique l'absence de vérité terrain, puis mesure précision et rappel", async () => {
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "analysis.mp4"); // analyse lancée automatiquement
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    expect((job.result as { detections: unknown[] }).detections.length).toBeGreaterThan(0);

    expect((await evaluateRecording(id)).status).toBe("no_truth");
    await addGroundTruth(u.id, id, 12_800); // mort réelle juste avant l'écran grisé (13 s)
    await addGroundTruth(u.id, id, 26_000); // mort non détectée
    const e = await evaluateRecording(id);
    expect(e.status).toBe("ok");
    if (e.status !== "ok") return;
    expect(e.truthSource).toBe("MANUAL");
    expect(e.result).toMatchObject({ tp: 1, fp: 0, fn: 1, precision: 1, recall: 0.5 });
    expect(Math.abs(e.result.meanOffsetMs!)).toBeLessThan(1000);
    expect(e.result.missed).toEqual([26_000]);

    const summary = await evaluationSummary();
    expect(summary).toEqual([expect.objectContaining({ version: "auto-0.1.0", videos: 1, tp: 1, fn: 1 })]);
  });

  it("la timeline Riot est prioritaire sur le marquage manuel", async () => {
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "analysis.mp4");
    await addGroundTruth(u.id, id, 5000);
    await prisma.groundTruthEvent.create({ data: { recordingId: id, videoMs: 13_100, source: "RIOT_TIMELINE" } });
    const e = await evaluateRecording(id);
    expect(e.status === "ok" && e.truthSource).toBe("RIOT_TIMELINE");
    expect(e.status === "ok" && e.result.tp).toBe(1);
  });

  it("signale une vidéo sans analyse terminée", async () => {
    const u = await makeUser("Ana");
    const rec = await prisma.recording.create({
      data: { ownerId: u.id, title: "x", originalFilename: "x.mp4", declaredMime: "", sizeBytes: 10n, originalKey: "k", status: "READY", durationMs: 1000 },
    });
    expect((await evaluateRecording(rec.id)).status).toBe("no_analysis");
  });
});
