import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { storage } from "@/server/storage";
import { clipExportFile, clipFromMoment, createClip, deleteClip, listClips, requestClipExport, updateClip } from "@/server/clips";
import { analyzerAvailable } from "@/server/analysis/runner";
import { createRecommendation, createAnnotation } from "@/server/video/coaching";
import { drain } from "@/worker/index";
import { makeUser, uploadFile } from "./helpers";

const moment = {
  kind: "MISTAKE", category: "POSITIONING", title: "Avancée sans vision",
  contextStartMs: 2000, slowdownStartMs: 5000, decisionMs: 7000, endMs: 11000,
  observations: ["Aucun ennemi visible"], alternatives: [{ label: "Rester derrière la vague" }],
  confidence: "MEDIUM", confidenceReason: "Position adverse inconnue", advice: "Reste derrière ta vague.",
};
const available = (await analyzerAvailable()).ok;

describe("bibliothèque de clips", () => {
  it("crée, filtre, met en favori, annote et supprime ses clips", async () => {
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "sample.mp4", { process: true });
    const a = await createClip(u.id, { recordingId: id, title: "Bon trade", kind: "GOOD_ACTION", startMs: 1000, endMs: 6000 });
    await createClip(u.id, { recordingId: id, title: "Mort bête", kind: "MISTAKE", startMs: 8000, endMs: 12000 });
    await expect(createClip(u.id, { recordingId: id, title: "Trop long", kind: "MISTAKE", startMs: 0, endMs: 200_000 })).rejects.toThrow();
    await expect(createClip(u.id, { recordingId: id, title: "Hors vidéo", kind: "MISTAKE", startMs: 15_000, endMs: 40_000 })).rejects.toThrow(/fin de la vidéo/);
    await updateClip(u.id, a.id, { favorite: true, personalNote: "Refaire ce timing" });
    expect((await listClips(u.id, { favorite: "1" })).map((c) => c.title)).toEqual(["Bon trade"]);
    expect((await listClips(u.id, { q: "timing" })).map((c) => c.title)).toEqual(["Bon trade"]);
    expect((await listClips(u.id, { kind: "MISTAKE" })).map((c) => c.title)).toEqual(["Mort bête"]);
    expect((await listClips(u.id, {}))[0]!.title).toBe("Bon trade"); // favoris en premier
    const eve = await makeUser("Eve");
    await expect(updateClip(eve.id, a.id, { favorite: false })).rejects.toMatchObject({ status: 404 });
    await expect(deleteClip(eve.id, a.id)).rejects.toMatchObject({ status: 404 });
    await deleteClip(u.id, a.id);
    expect(await listClips(u.id, {})).toHaveLength(1);
  });

  it("clip sur une vidéo partagée : autorisé, puis masqué quand le partage est retiré", async () => {
    const owner = await makeUser("Bob");
    const friend = await makeUser("Ana");
    const id = await uploadFile(owner.id, "sample.webm", { process: true });
    await expect(createClip(friend.id, { recordingId: id, title: "x", kind: "FIGHT", startMs: 0, endMs: 2000 })).rejects.toMatchObject({ status: 404 });
    const share = await prisma.sharePermission.create({ data: { recordingId: id, grantedById: owner.id, granteeUserId: friend.id } });
    await createClip(friend.id, { recordingId: id, title: "Combat de Bob", kind: "FIGHT", startMs: 0, endMs: 2000 });
    expect(await listClips(friend.id, {})).toHaveLength(1);
    await prisma.sharePermission.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
    expect(await listClips(friend.id, {})).toHaveLength(0);
  });

  it("transforme un moment en clip (sans doublon)", async () => {
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "sample.mp4", { process: true });
    const r = await createRecommendation(u.id, id, moment);
    const c1 = await clipFromMoment(u.id, r.id);
    const c2 = await clipFromMoment(u.id, r.id);
    expect(c1.id).toBe(c2.id);
    expect([c1.startMs, c1.endMs, c1.kind]).toEqual([2000, 11000, "MISTAKE"]);
  });
});

describe.skipIf(!available)("export vidéo annotée (rendu réel)", () => {
  it("produit un MP4 avec ralenti et pause pédagogique, sans incruster les brouillons automatiques", async () => {
    const u = await makeUser("Ana");
    const id = await uploadFile(u.id, "sample.mp4", { process: true });
    const r = await createRecommendation(u.id, id, moment);
    await createAnnotation(u.id, id, { type: "path", style: "alternative", startMs: 6000, endMs: 10_000, geometry: { points: [{ x: 0.3, y: 0.6 }, { x: 0.2, y: 0.8 }] }, recommendationId: r.id });
    // Brouillon automatique (non validé) dans la même fenêtre : ne doit pas être incrusté
    const draft = await prisma.recommendation.create({
      data: { recordingId: id, kind: "INTERESTING", category: "ENGAGEMENT", title: "Brouillon auto", contextStartMs: 3000, slowdownStartMs: 4000, decisionMs: 6000, endMs: 9000, interpretation: "", alternatives: [], confidence: "INCONCLUSIVE", confidenceReason: "auto", advice: "", provenance: "AUTOMATIC", status: "DRAFT" },
    });
    await prisma.videoAnnotation.create({ data: { recordingId: id, recommendationId: draft.id, type: "text", startMs: 6000, endMs: 8000, space: "FRAME", geometry: { at: { x: 0.5, y: 0.5 } }, style: "neutral", label: "auto", provenance: "AUTOMATIC" } });

    const clip = await clipFromMoment(u.id, r.id);
    await requestClipExport(u.id, clip.id);
    await drain();
    const done = await prisma.clip.findUniqueOrThrow({ where: { id: clip.id } });
    expect(done.exportStatus).toBe("READY");
    const job = await prisma.analysisJob.findFirstOrThrow({ where: { type: "EXPORT_CLIP", recordingId: id } });
    expect(job.result).toMatchObject({ annotations: 1, moments: 1 });
    const file = storage().localPath((await clipExportFile(u.id, clip.id)).exportKey!);
    const dur = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout);
    // 9 s de clip + 2 s de ralenti ×0,5 (5→7 s doublées) + 5 s de pause = 16 s
    expect(dur).toBeGreaterThan(15.5);
    expect(dur).toBeLessThan(16.5);
    const notif = await prisma.notification.findFirst({ where: { userId: u.id, type: "clip_exported" } });
    expect(notif).not.toBeNull();
    // La suppression du clip supprime le fichier exporté
    await deleteClip(u.id, clip.id);
    expect(await storage().size(done.exportKey!)).toBeNull();
  });

  it("refuse l'export si l'accès à la vidéo a été retiré", async () => {
    const owner = await makeUser("Bob");
    const friend = await makeUser("Ana");
    const id = await uploadFile(owner.id, "sample.webm", { process: true });
    const share = await prisma.sharePermission.create({ data: { recordingId: id, grantedById: owner.id, granteeUserId: friend.id } });
    const clip = await createClip(friend.id, { recordingId: id, title: "x", kind: "FIGHT", startMs: 0, endMs: 3000 });
    await prisma.sharePermission.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
    await expect(requestClipExport(friend.id, clip.id)).rejects.toMatchObject({ status: 404 });
  });
});
