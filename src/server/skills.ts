// Page « Rang suivant » : rang actuel, écarts par dimension, conseils et exemples vidéo.
// Exemples : uniquement des moments publiés (validés) de vidéos que l'utilisateur peut déjà voir —
// les siennes et celles que ses amis lui ont partagées. Jamais de brouillon non vérifié.
import { prisma } from "./db";
import { visibleRecordingWhere } from "./permissions";
import { progressProfile } from "./progress";
import { TIERS, nextRankPlan, nextTier, type Tier } from "@/lib/nextRank";

export async function skillsPlan(userId: string) {
  const [identity, profile] = await Promise.all([
    prisma.gameIdentity.findFirst({ where: { userId, isPrimary: true }, select: { gameName: true, tagLine: true, rank: true } }),
    progressProfile(userId),
  ]);
  const ranks = (identity?.rank ?? []) as { queue: string; tier: string; division: string; lp: number }[];
  const solo = ranks.find((r) => r.queue === "RANKED_SOLO_5x5") ?? ranks[0] ?? null;
  const current = solo && (TIERS as readonly string[]).includes(solo.tier) ? (solo.tier as Tier) : null;
  const target = nextTier(current);
  const plan = nextRankPlan(profile.trends.map((t) => ({ key: t.key, avg: t.avg })), target);

  const moments = await prisma.recommendation.findMany({
    where: {
      status: "PUBLISHED",
      category: { in: [...new Set(plan.flatMap((p) => p.categories))] as never[] },
      recording: { status: "READY", ...visibleRecordingWhere(userId) },
    },
    select: {
      id: true, title: true, kind: true, category: true, advice: true, contextStartMs: true, recordingId: true,
      recording: { select: { ownerId: true, owner: { select: { displayName: true } } } },
      annotations: { select: { type: true, style: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  // Bons gestes d'abord, puis moments avec alternative dessinée (schéma, clic conseillé).
  const score = (m: (typeof moments)[number]) =>
    (m.kind === "GOOD_ACTION" ? 4 : 0) + (m.annotations.some((a) => a.type === "click") ? 2 : 0) + (m.annotations.some((a) => a.style === "alternative") ? 1 : 0);
  const items = plan.map((p) => ({
    ...p,
    examples: moments
      .filter((m) => p.categories.includes(m.category))
      .sort((a, b) => score(b) - score(a))
      .slice(0, 3)
      .map((m) => ({
        id: m.id,
        title: m.title,
        good: m.kind === "GOOD_ACTION",
        advice: m.advice,
        mine: m.recording.ownerId === userId,
        owner: m.recording.owner.displayName,
        href: `/app/videos/${m.recordingId}?t=${m.contextStartMs}`,
        hasClicks: m.annotations.some((a) => a.type === "click"),
      })),
  }));
  return { riotId: identity ? `${identity.gameName}#${identity.tagLine}` : null, current: solo, currentTier: current, target, measured: profile.total, items };
}
