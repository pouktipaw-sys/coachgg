import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createAnnotation, createRecommendation, deleteRecommendation, getCoachingData, updateAnnotation } from "@/server/video/coaching";
import { recordingAccess } from "@/server/permissions";
import { makeUser, uploadFile } from "./helpers";

const moment = {
  kind: "MISTAKE",
  category: "POSITIONING",
  title: "Avancée sans vision",
  contextStartMs: 2000,
  slowdownStartMs: 5000,
  decisionMs: 7000,
  endMs: 11000,
  observations: ["Aucun ennemi visible sur la minimap", "Allié jungle en haut"],
  interpretation: "Risque d'embuscade.",
  alternatives: [{ label: "Rester derrière la vague", conditions: "jungle adverse inconnue", limits: "moins de pression" }],
  confidence: "MEDIUM",
  confidenceReason: "Position adverse inconnue",
  advice: "Sans vision, reste derrière ta vague.",
};

describe("moments de coaching et annotations (persistance)", () => {
  it("enregistre un moment structuré avec ses observations et le relit", async () => {
    const u = await makeUser("Alice");
    const id = await uploadFile(u.id, "sample.mp4");
    const r = await createRecommendation(u.id, id, moment);
    expect(r.observations).toHaveLength(2);
    expect(r.provenance).toBe("MANUAL");
    expect(r.analysisVersion).toBe("manual-1");

    const ann = await createAnnotation(u.id, id, {
      type: "path",
      style: "alternative",
      startMs: 6500,
      endMs: 10_000,
      geometry: { points: [{ x: 0.3, y: 0.6 }, { x: 0.2, y: 0.8 }] },
      recommendationId: r.id,
    });
    expect(ann.provenance).toBe("MANUAL");
    expect(ann.schemaVersion).toBe(1);

    const data = await getCoachingData(u.id, id);
    expect(data.recommendations[0]!.annotations).toHaveLength(1);
    expect(data.annotations[0]!.geometry).toEqual({ points: [{ x: 0.3, y: 0.6 }, { x: 0.2, y: 0.8 }] });
  });

  it("refuse un horodatage au-delà de la fin de la vidéo", async () => {
    const u = await makeUser("Alice");
    const id = await uploadFile(u.id, "sample.mp4");
    await expect(createRecommendation(u.id, id, { ...moment, endMs: 60_000 })).rejects.toThrow(/fin de la vidéo/);
  });

  it("refuse une annotation minimap tant que la zone n'est pas définie", async () => {
    const u = await makeUser("Alice");
    const id = await uploadFile(u.id, "sample.mp4");
    const input = { type: "marker", style: "alternative", space: "MINIMAP", startMs: 1000, endMs: 3000, geometry: { at: { x: 0.5, y: 0.5 } } };
    await expect(createAnnotation(u.id, id, input)).rejects.toThrow(/minimap/);
    await prisma.recording.update({ where: { id }, data: { minimapRegion: { x: 0.8, y: 0.7, w: 0.2, h: 0.3 } } });
    expect((await createAnnotation(u.id, id, input)).space).toBe("MINIMAP");
  });

  it("met à jour les bornes d'une annotation et détache les annotations d'un moment supprimé", async () => {
    const u = await makeUser("Alice");
    const id = await uploadFile(u.id, "sample.mp4");
    const r = await createRecommendation(u.id, id, moment);
    const a = await createAnnotation(u.id, id, { type: "click", style: "alternative", startMs: 7000, endMs: 9000, geometry: { at: { x: 0.2, y: 0.8 } }, recommendationId: r.id });
    const upd = await updateAnnotation(u.id, a.id, { type: "click", style: "alternative", startMs: 6800, endMs: 9000, geometry: { at: { x: 0.2, y: 0.8 } }, recommendationId: r.id });
    expect(upd.startMs).toBe(6800);
    await deleteRecommendation(u.id, r.id);
    expect((await prisma.videoAnnotation.findUniqueOrThrow({ where: { id: a.id } })).recommendationId).toBeNull();
  });
});

describe("permissions vidéo", () => {
  it("un autre utilisateur ne voit pas une vidéo privée et ne peut pas l'annoter", async () => {
    const a = await makeUser("A");
    const b = await makeUser("B");
    const id = await uploadFile(a.id, "sample.webm");
    expect(await recordingAccess(b.id, id)).toBeNull();
    await expect(getCoachingData(b.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(createRecommendation(b.id, id, { ...moment, endMs: 5000, decisionMs: 4000, slowdownStartMs: 3000, contextStartMs: 1000 })).rejects.toMatchObject({ status: 404 });
  });

  it("être dans le même groupe ne donne PAS accès ; un partage explicite, oui ; le retrait ou le départ le coupe", async () => {
    const a = await makeUser("A");
    const b = await makeUser("B");
    const team = await prisma.team.create({
      data: { name: "Duo", memberships: { create: [{ userId: a.id, role: "ADMIN" }, { userId: b.id }] } },
    });
    const id = await uploadFile(a.id, "sample.webm");
    expect(await recordingAccess(b.id, id)).toBeNull();

    const share = await prisma.sharePermission.create({ data: { recordingId: id, grantedById: a.id, granteeTeamId: team.id } });
    expect(await recordingAccess(b.id, id)).toBe("shared");
    // partagé ≠ propriétaire : lecture seule
    await expect(createAnnotation(b.id, id, { type: "marker", style: "neutral", startMs: 0, endMs: 1000, geometry: { at: { x: 0.5, y: 0.5 } } })).rejects.toMatchObject({ status: 403 });

    await prisma.teamMembership.delete({ where: { teamId_userId: { teamId: team.id, userId: b.id } } });
    expect(await recordingAccess(b.id, id)).toBeNull(); // départ du groupe

    await prisma.teamMembership.create({ data: { teamId: team.id, userId: b.id } });
    expect(await recordingAccess(b.id, id)).toBe("shared");
    await prisma.sharePermission.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
    expect(await recordingAccess(b.id, id)).toBeNull(); // retrait du partage
  });
});
