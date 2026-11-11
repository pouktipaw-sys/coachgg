// Analyse IA de bout en bout avec un faux client Claude (aucun appel réel, aucun coût) :
// vraie vidéo, vrai Python/FFmpeg ; vérifie images envoyées, schéma + conseil, bilan, récap monté.
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { storage } from "@/server/storage";
import { aiDeps, type AiClient } from "@/server/analysis/ai";
import { analyzerAvailable } from "@/server/analysis/runner";
import { makeUser, uploadFile } from "./helpers";

const available = (await analyzerAvailable()).ok;
const original = aiDeps.client;

type Req = { messages: { content: string | { type: string }[] }[] };
function fakeClaude(calls: Req[]) {
  const usage = { input_tokens: 4000, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  return {
    beta: {
      messages: {
        parse: async (req: Req) => {
          calls.push(req);
          const content = req.messages[0]!.content;
          const isMoment = Array.isArray(content) && content.some((b) => b.type === "image");
          const parsed_output = isMoment
            ? {
                readable: true,
                title: "Mort en avançant seul sans vision",
                kind: "MISTAKE",
                category: "VISION",
                observations: ["Image 4 : aucun allié visible autour du champion.", "Image 5 : deux ennemis apparaissent à droite."],
                interpretation: "Le joueur avance dans une zone sans vision alors que ses alliés sont loin.",
                alternative: { label: "Reculer vers la tourelle", conditions: "si les ennemis ne sont pas visibles", limits: "l'issue n'est pas garantie" },
                advice: "Avant d'avancer, regarde la minimap et pose une balise.",
                confidence: "MEDIUM",
                confidenceReason: "Ennemis visibles juste avant la mort.",
                decisionImage: 4,
                drawing: {
                  actualPath: [{ x: 0.5, y: 0.5 }, { x: 0.62, y: 0.42 }],
                  saferPath: [{ x: 0.5, y: 0.5 }, { x: 0.35, y: 0.7 }, { x: 1.4, y: -0.2 }],
                  saferLabel: "Reculer vers la tourelle",
                  danger: { x: 0.7, y: 0.4, r: 0.12 },
                  enemies: [{ x: 0.72, y: 0.38 }],
                },
              }
            : {
                summary: "Une mort évitable par manque de vision.",
                patterns: ["Avancer sans vision"],
                priorities: [
                  { title: "Vision", why: "La mort vient d'une zone sombre.", drill: "Balise avant d'entrer dans la jungle." },
                  { title: "Placement", why: "Seul loin des alliés.", drill: "Reste à portée de tes alliés." },
                  { title: "Minimap", why: "Ennemis visibles avant la mort.", drill: "Regarde la minimap toutes les 5 s." },
                ],
                nextGameGoal: "Moins de 4 morts.",
              };
          return { model: "claude-opus-5-5", usage, stop_reason: "end_turn", parsed_output };
        },
      },
    },
  } as unknown as AiClient;
}

afterEach(() => {
  aiDeps.client = original;
  delete process.env.ANTHROPIC_API_KEY;
});

describe.skipIf(!available)("analyse IA (faux client Claude)", () => {
  it("chaque mort est analysée sur images : schéma + conseil, bilan IA, vidéo récap montée", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const calls: Req[] = [];
    aiDeps.client = () => fakeClaude(calls);
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "analysis.mp4"); // traitement → analyse → récap (worker)

    const momentCall = calls.find((c) => Array.isArray(c.messages[0]!.content))!;
    expect((momentCall.messages[0]!.content as { type: string }[]).filter((b) => b.type === "image")).toHaveLength(6);

    const rec = await prisma.recommendation.findFirstOrThrow({ where: { recordingId: id, title: "Mort en avançant seul sans vision" }, include: { annotations: true, observations: true } });
    expect(rec).toMatchObject({ status: "DRAFT", provenance: "AUTOMATIC", kind: "MISTAKE", category: "VISION", confidence: "MEDIUM", advice: "Avant d'avancer, regarde la minimap et pose une balise." });
    expect(rec.analysisVersion).toBe("ia-1.0.0 (claude-opus-5-5)");
    expect(rec.annotations.map((a) => `${a.type}:${a.style}`).sort()).toEqual(["highlight:enemy", "path:actual", "path:alternative", "zone:danger"]);
    const alt = rec.annotations.find((a) => a.style === "alternative")!;
    expect((alt.geometry as { points: { x: number; y: number }[] }).points[2]).toEqual({ x: 1, y: 0 }); // coordonnées bornées
    expect(alt.label).toBe("Reculer vers la tourelle");

    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    expect(job.costMicros).toBeGreaterThan(0);
    const steps = (job.result as { steps: { name: string; note?: string }[] }).steps;
    expect(steps.find((s) => s.name === "Analyse IA des moments (Claude)")!.note).toMatch(/1\/1 moment/);

    const recording = await prisma.recording.findUniqueOrThrow({ where: { id } });
    expect(recording.gameReport).toMatchObject({ source: "ai", summary: "Une mort évitable par manque de vision.", nextGameGoal: "Moins de 4 morts." });
    expect(recording.recapStatus).toBe("READY");
    const file = storage().localPath(recording.recapKey!);
    const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
    expect(dur).toBeGreaterThan(4 + 8); // intro + au moins un moment + bilan
    expect(await prisma.notification.count({ where: { userId: u.id, type: "recap_ready" } })).toBe(1);
  });

  it("sans clé : règles seules, bilan sans IA, récap quand même monté ; un ami n'en voit rien", async () => {
    let called = false;
    aiDeps.client = () => {
      called = true;
      return fakeClaude([]);
    };
    const u = await makeUser("Bob");
    const id = await uploadFile(u.id, "analysis.mp4");
    expect(called).toBe(false);
    const recording = await prisma.recording.findUniqueOrThrow({ where: { id } });
    expect(recording.gameReport).toMatchObject({ source: "rules" });
    expect((recording.gameReport as { priorities: unknown[] }).priorities).toHaveLength(3);
    expect(recording.recapStatus).toBe("READY");

    const friend = await makeUser("Cy");
    await prisma.sharePermission.create({ data: { recordingId: id, grantedById: u.id, granteeUserId: friend.id } });
    const { getCoachingData } = await import("@/server/video/coaching");
    const seen = await getCoachingData(friend.id, id);
    expect(seen.recording.gameReport).toBeNull();
    expect(seen.recording.recapKey).toBeNull();
  });
});
