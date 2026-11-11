// Progression : porteur ou porté (notes des coéquipiers), plan pour le rang suivant (exemples vidéo visibles uniquement).
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createManualMatch, type ManualMatchInput } from "@/server/matches/service";
import { impactProfile } from "@/server/progress";
import { skillsPlan } from "@/server/skills";
import { makeUser } from "./helpers";

type P = ManualMatchInput["participants"][number];
const pl = (o: Partial<P>): P => ({ isMe: false, championName: "Ahri", role: "MIDDLE", teamSide: 100, win: true, kills: 5, deaths: 3, assists: 7, creepScore: 200, goldEarned: 11000, damageToChampions: 18000, damageToObjectives: 5000, visionScore: 25, ...o });

/** Partie à 5 où « moi » est nettement moins bon que les 4 autres, et victoire. */
async function carriedGame(userId: string, i: number) {
  await createManualMatch(userId, {
    durationSec: 1800,
    gameMode: "NORMAL",
    gameStartAt: new Date(Date.now() - (i + 1) * 3600_000),
    participants: [
      pl({ isMe: true, riotGameName: "Me", riotTagLine: "EUW", kills: 0, deaths: 9, assists: 2, creepScore: 90, damageToChampions: 4000, damageToObjectives: 300, visionScore: 5 }),
      ...["A", "B", "C", "D"].map((n, k) => pl({ riotGameName: n, riotTagLine: "EUW", role: (["TOP", "JUNGLE", "BOTTOM", "UTILITY"] as const)[k], kills: 8, deaths: 2, assists: 10 })),
    ],
  });
}

describe("progression avancée", () => {
  it("détecte que le joueur s'est fait porter, chiffres à l'appui", async () => {
    const u = await makeUser("Ana");
    await prisma.gameIdentity.create({ data: { userId: u.id, gameName: "Me", tagLine: "EUW", platform: "EUW1" } });
    for (let i = 0; i < 5; i++) await carriedGame(u.id, i);
    const impact = await impactProfile(u.id);
    expect(impact.n).toBe(5);
    expect(impact.counts.CARRIED).toBe(5);
    expect(impact.verdict.kind).toBe("CARRIED");
  });

  it("plan pour le rang suivant : rang Riot, priorités, exemples uniquement publiés et visibles", async () => {
    const u = await makeUser("Ana");
    const other = await makeUser("Zed");
    await prisma.gameIdentity.create({
      data: { userId: u.id, gameName: "Me", tagLine: "EUW", platform: "EUW1", rank: [{ queue: "RANKED_SOLO_5x5", tier: "GOLD", division: "II", lp: 40, wins: 1, losses: 1 }] },
    });
    for (let i = 0; i < 3; i++) await carriedGame(u.id, i);
    const rec = (ownerId: string) =>
      prisma.recording.create({ data: { ownerId, title: "v", originalFilename: "v.mp4", declaredMime: "", sizeBytes: 10n, originalKey: "k", playbackKey: "p", status: "READY", durationMs: 60_000 } });
    const mine = await rec(u.id);
    const theirs = await rec(other.id); // non partagée : jamais montrée
    const moment = (recordingId: string, title: string, status: "PUBLISHED" | "DRAFT", kind: "GOOD_ACTION" | "MISTAKE") =>
      prisma.recommendation.create({
        data: { recordingId, kind, category: "VISION", title, contextStartMs: 1000, slowdownStartMs: 2000, decisionMs: 3000, endMs: 6000, interpretation: "", alternatives: [], confidence: "LOW", confidenceReason: "", advice: "Balise", provenance: "MANUAL", status },
      });
    await moment(mine.id, "Bonne balise", "PUBLISHED", "GOOD_ACTION");
    await moment(mine.id, "Brouillon", "DRAFT", "MISTAKE");
    await moment(theirs.id, "Privé d'un autre", "PUBLISHED", "GOOD_ACTION");

    const s = await skillsPlan(u.id);
    expect(s.currentTier).toBe("GOLD");
    expect(s.target).toBe("PLATINUM");
    expect(s.items[0]!.gap).toBeGreaterThan(0);
    const vision = s.items.find((i) => i.key === "vision")!;
    expect(vision.examples.map((e) => e.title)).toEqual(["Bonne balise"]);
    expect(vision.examples[0]!.href).toBe(`/app/videos/${mine.id}?t=1000`);
  });
});
