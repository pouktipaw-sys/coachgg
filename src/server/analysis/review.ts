// Revue humaine des propositions automatiques. Une proposition n'est visible
// des personnes avec qui la vidéo est partagée qu'après validation par le propriétaire.
import type { Prisma, RecommendationStatus } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, notFound } from "../errors";
import { recordingAccess, requireRecordingOwner } from "../permissions";

export const PUBLIC_STATUSES: RecommendationStatus[] = ["PUBLISHED", "DISPUTED"];

/** Filtre des moments visibles selon le niveau d'accès à la vidéo. */
export function visibleRecommendationWhere(isOwner: boolean): Prisma.RecommendationWhereInput {
  return isOwner ? { status: { not: "REJECTED" } } : { status: { in: PUBLIC_STATUSES } };
}

export function visibleAnnotationWhere(isOwner: boolean): Prisma.VideoAnnotationWhereInput {
  return isOwner
    ? { OR: [{ recommendationId: null }, { recommendation: { status: { not: "REJECTED" } } }] }
    : { OR: [{ recommendationId: null }, { recommendation: { status: { in: PUBLIC_STATUSES } } }] };
}

export async function canSeeRecommendation(userId: string, recommendationId: string) {
  const r = await prisma.recommendation.findUnique({ where: { id: recommendationId }, select: { recordingId: true, status: true } });
  if (!r) return null;
  const access = await recordingAccess(userId, r.recordingId);
  if (!access) return null;
  if (access === "owner" ? r.status === "REJECTED" : !PUBLIC_STATUSES.includes(r.status)) return null;
  return { ...r, access };
}

export async function reviewRecommendation(userId: string, recommendationId: string, action: "validate" | "reject", comment?: string) {
  const r = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!r) throw notFound("Moment");
  await requireRecordingOwner(userId, r.recordingId);
  if (r.provenance !== "AUTOMATIC" || r.status !== "DRAFT") throw badRequest("Seules les propositions automatiques en attente peuvent être revues.");
  const status: RecommendationStatus = action === "validate" ? "PUBLISHED" : "REJECTED";
  const [updated] = await prisma.$transaction([
    prisma.recommendation.update({ where: { id: r.id }, data: { status, reviewedAt: new Date(), reviewedById: userId } }),
    prisma.analysisFeedback.create({
      data: { userId, recommendationId: r.id, kind: action === "validate" ? "HELPFUL" : "INCORRECT", comment: comment ?? (action === "validate" ? "Validée à la revue" : "Rejetée à la revue") },
    }),
  ]);
  return updated;
}

/** Précision mesurée des propositions automatiques, par version de règles. */
export async function automaticPrecision() {
  const rows = await prisma.recommendation.groupBy({
    by: ["analysisVersion", "status", "humanEdited"],
    where: { provenance: "AUTOMATIC" },
    _count: { _all: true },
  });
  const byVersion = new Map<string, { pending: number; validated: number; edited: number; rejected: number }>();
  for (const r of rows) {
    const v = byVersion.get(r.analysisVersion) ?? { pending: 0, validated: 0, edited: 0, rejected: 0 };
    if (r.status === "DRAFT") v.pending += r._count._all;
    else if (r.status === "REJECTED") v.rejected += r._count._all;
    else {
      v.validated += r._count._all;
      if (r.humanEdited) v.edited += r._count._all;
    }
    byVersion.set(r.analysisVersion, v);
  }
  return [...byVersion.entries()].map(([version, v]) => ({
    version,
    ...v,
    precision: v.validated + v.rejected > 0 ? Math.round((v.validated / (v.validated + v.rejected)) * 100) : null,
  }));
}
