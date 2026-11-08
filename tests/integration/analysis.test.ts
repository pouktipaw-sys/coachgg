// Analyse assistée de bout en bout : vrai Python/OpenCV, vrai FFmpeg, vidéo de
// synthèse contrôlée (marqueurs rouges dans la « minimap » de 6 à 13 s,
// image grisée de 13 à 20 s).
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { storage } from "@/server/storage";
import { getCoachingData } from "@/server/video/coaching";
import { requestAnalysis } from "@/server/analysis/job";
import { reviewRecommendation, automaticPrecision, canSeeRecommendation } from "@/server/analysis/review";
import { analyzerAvailable, resetAnalyzerAvailability } from "@/server/analysis/runner";
import { drain } from "@/worker/index";
import { makeUser, uploadFile } from "./helpers";

const MINIMAP = { x: 1000 / 1280, y: 480 / 720, w: 240 / 1280, h: 240 / 720 };
const available = (await analyzerAvailable()).ok;

describe.skipIf(!available)("analyse vidéo assistée (Python/OpenCV réels)", () => {
  it("s'enchaîne automatiquement après le traitement, sans minimap : statut partiel documenté, brouillon prudent", async () => {
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "analysis.mp4");
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    expect(job.status).toBe("NEEDS_REVIEW");
    const res = job.result as { steps: { name: string; status: string }[]; warnings: string[]; version: string };
    expect(res.version).toBe("auto-0.1.0");
    expect(res.steps.map((s) => s.name)).toEqual([
      "Validation de la vidéo",
      "Association au match",
      "Synchronisation des horodatages",
      "Extraction des signaux et sélection des séquences",
      "Propositions (règles auto-0.1.0)",
      "Annotations et enregistrement pour revue",
    ]);
    expect(res.warnings.join(" ")).toMatch(/minimap non définie/);
    expect(job.processingMs).toBeGreaterThan(0);

    const recs = await prisma.recommendation.findMany({ where: { recordingId: id }, include: { observations: true, annotations: true } });
    const grey = recs.find((r) => r.title.startsWith("Écran grisé"))!;
    expect(grey).toBeTruthy();
    expect(grey.status).toBe("DRAFT");
    expect(grey.provenance).toBe("AUTOMATIC");
    expect(grey.kind).toBe("INTERESTING"); // pas « erreur »
    expect(grey.confidence).toBe("INCONCLUSIVE");
    expect(Math.abs(grey.decisionMs - 11000)).toBeLessThanOrEqual(600); // 2 s avant l'écran grisé détecté à ~13 s
    expect(grey.observations.every((o) => o.provenance === "AUTOMATIC")).toBe(true);
    expect(grey.contextSheetKey).toBeTruthy();
    expect(await storage().size(grey.contextSheetKey!)).toBeGreaterThan(1000);
    expect(grey.annotations.every((a) => a.provenance === "AUTOMATIC")).toBe(true);
    const notif = await prisma.notification.findFirst({ where: { userId: u.id, type: "analysis_done" } });
    expect(notif?.body).toMatch(/à valider/);
  });

  it("avec la minimap définie : hausse de marqueurs rouges mesurée avant la mort, alternative conditionnelle, annotation minimap", async () => {
    const u = await makeUser("Bob");
    const id = await uploadFile(u.id, "analysis.mp4");
    await prisma.recording.update({ where: { id }, data: { minimapRegion: MINIMAP, gameStartOffsetMs: 2000 } });
    await requestAnalysis(id, 10);
    await drain();
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
    expect(job.status).toBe("NEEDS_REVIEW");
    const recs = await prisma.recommendation.findMany({ where: { recordingId: id, status: "DRAFT" }, include: { annotations: true, observations: true } });
    expect(recs.filter((r) => r.title.startsWith("Écran grisé"))).toHaveLength(1); // relance idempotente : pas de doublon
    const grey = recs.find((r) => r.title.startsWith("Écran grisé"))!;
    expect(grey.confidence).toBe("LOW");
    expect(grey.category).toBe("VISION");
    expect((grey.alternatives as { limits: string }[])[0]!.limits).toMatch(/pas vérifiée/);
    expect(grey.observations.map((o) => o.text).join(" ")).toMatch(/marqueurs rouges/);
    expect(grey.observations[0]!.text).toMatch(/jeu 0:1/); // temps de jeu (synchronisation)
    const hl = grey.annotations.find((a) => a.type === "highlight")!;
    expect(hl.space).toBe("MINIMAP");
    expect(hl.endMs).toBeLessThanOrEqual(13000);
    const c = (hl.geometry as { at: { x: number; y: number } }).at;
    expect(c.x).toBeGreaterThan(0.55);
    expect(c.x).toBeLessThan(0.8);
    expect(c.y).toBeLessThan(0.3);
  });

  it("les brouillons ne sont visibles que du propriétaire ; validation et rejet ; précision mesurée", async () => {
    const owner = await makeUser("Ana");
    const friend = await makeUser("Bob");
    const team = await prisma.team.create({ data: { name: "Duo", memberships: { create: [{ userId: owner.id, role: "ADMIN" }, { userId: friend.id }] } } });
    const id = await uploadFile(owner.id, "analysis.mp4");
    await prisma.sharePermission.create({ data: { recordingId: id, grantedById: owner.id, granteeTeamId: team.id } });
    const draft = await prisma.recommendation.findFirstOrThrow({ where: { recordingId: id, status: "DRAFT" } });

    expect((await getCoachingData(owner.id, id)).recommendations.map((r) => r.id)).toContain(draft.id);
    const seen = await getCoachingData(friend.id, id);
    expect(seen.recommendations).toHaveLength(0);
    expect(seen.annotations.filter((a) => a.provenance === "AUTOMATIC")).toHaveLength(0);
    expect(await canSeeRecommendation(friend.id, draft.id)).toBeNull();
    await expect(reviewRecommendation(friend.id, draft.id, "validate")).rejects.toMatchObject({ status: 403 });

    await reviewRecommendation(owner.id, draft.id, "validate");
    expect((await getCoachingData(friend.id, id)).recommendations.map((r) => r.id)).toEqual([draft.id]);
    await expect(reviewRecommendation(owner.id, draft.id, "reject")).rejects.toThrow(/en attente/);

    // relance : la proposition validée n'est pas recréée en brouillon
    await requestAnalysis(id, 10);
    await drain();
    const same = await prisma.recommendation.findMany({ where: { recordingId: id, title: { startsWith: "Écran grisé" } } });
    expect(same).toHaveLength(1);

    const prec = await automaticPrecision();
    expect(prec.find((p) => p.version === "auto-0.1.0")?.validated).toBe(1);
  });

  it("un rejet masque la proposition et ses annotations, et reste comptabilisé", async () => {
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "analysis.mp4");
    const draft = await prisma.recommendation.findFirstOrThrow({ where: { recordingId: id, status: "DRAFT" } });
    await reviewRecommendation(u.id, draft.id, "reject", "Ce n'est pas une mort");
    const data = await getCoachingData(u.id, id);
    expect(data.recommendations.map((r) => r.id)).not.toContain(draft.id);
    expect(data.annotations.some((a) => a.recommendationId === draft.id)).toBe(false);
    const fb = await prisma.analysisFeedback.findFirstOrThrow({ where: { recommendationId: draft.id } });
    expect(fb.kind).toBe("INCORRECT");
    expect((await automaticPrecision())[0]!.rejected).toBe(1);
  });

  it("l'échec de l'analyse n'affecte ni la vidéo ni ses moments manuels", async () => {
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "sample.webm");
    const prev = process.env.ANALYSIS_PYTHON;
    process.env.ANALYSIS_PYTHON = "/nonexistent/python";
    resetAnalyzerAvailability();
    try {
      await requestAnalysis(id, 10);
      await drain();
      const job = await prisma.analysisJob.findFirstOrThrow({ where: { recordingId: id, type: "ANALYZE_RECORDING" } });
      expect(job.status).toBe("FAILED");
      expect(job.error).toMatch(/non configurée/);
      expect(job.attempts).toBe(1); // erreur de configuration : pas de nouvelle tentative inutile
      expect((await prisma.recording.findUniqueOrThrow({ where: { id } })).status).toBe("READY");
    } finally {
      process.env.ANALYSIS_PYTHON = prev;
      resetAnalyzerAvailability();
    }
  });
});
