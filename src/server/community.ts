// Espace communauté : reels (clips exportés) et mini-forum (exploits, questions, discussions).
// • Un reel ne diffuse que le CLIP EXPORTÉ (extrait annoté), jamais la vidéo complète.
// • Seuls les clips de ses propres vidéos peuvent être publiés (pas ceux qu'un ami a partagés).
// • Supprimer la publication (ou le clip) retire immédiatement l'accès.
// • Signalement par tout membre ; la modération masque le contenu.
import type { CommunityPostKind, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { HttpError, forbidden, notFound } from "./errors";
import { notify } from "./notifications";
import { requestClipExport } from "./clips";

export const KINDS = ["CLIP", "EXPLOIT", "QUESTION", "DISCUSSION"] as const;
export const KIND_LABEL: Record<CommunityPostKind, string> = { CLIP: "🎬 Reel", EXPLOIT: "🏆 Exploit", QUESTION: "❓ Conseil demandé", DISCUSSION: "💬 Discussion" };

export const postSchema = z
  .object({
    kind: z.enum(KINDS),
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().max(4000).default(""),
    clipId: z.string().nullish(),
  })
  .refine((p) => p.kind !== "CLIP" || !!p.clipId, { message: "Un reel nécessite un clip.", path: ["clipId"] });

const authorSelect = {
  id: true,
  displayName: true,
  gameIdentities: { where: { isPrimary: true }, select: { gameName: true, tagLine: true, rank: true } },
} satisfies Prisma.UserSelect;

async function isAdmin(userId: string) {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role === "ADMIN";
}

export async function createPost(userId: string, raw: unknown) {
  const input = postSchema.parse(raw);
  if (input.clipId) {
    const clip = await prisma.clip.findUnique({ where: { id: input.clipId }, include: { recording: { select: { ownerId: true } } } });
    if (!clip || clip.ownerId !== userId) throw notFound("Clip");
    if (clip.recording.ownerId !== userId) throw forbidden("Seuls les clips de tes propres vidéos peuvent être publiés.");
    if (clip.exportStatus !== "READY" && clip.exportStatus !== "PENDING" && clip.exportStatus !== "RUNNING") await requestClipExport(userId, clip.id);
  }
  return prisma.communityPost.create({ data: { authorId: userId, kind: input.kind, title: input.title, body: input.body, clipId: input.clipId ?? null } });
}

/** Un reel n'est visible des autres qu'une fois son clip exporté. */
const visibleWhere = (userId: string): Prisma.CommunityPostWhereInput => ({
  hiddenAt: null,
  OR: [{ clipId: null }, { clip: { exportStatus: "READY" } }, { authorId: userId }],
});

const postInclude = (userId: string) =>
  ({
    author: { select: authorSelect },
    clip: { select: { id: true, exportStatus: true, endMs: true, startMs: true } },
    _count: { select: { likes: true, comments: { where: { hiddenAt: null } } } },
    likes: { where: { userId }, select: { userId: true } },
  }) satisfies Prisma.CommunityPostInclude;

type PostRow = Prisma.CommunityPostGetPayload<{ include: ReturnType<typeof postInclude> }>;

function toDTO(userId: string, p: PostRow) {
  const id = p.author.gameIdentities[0];
  return {
    id: p.id,
    kind: p.kind,
    title: p.title,
    body: p.body,
    createdAt: p.createdAt,
    mine: p.authorId === userId,
    author: { id: p.author.id, displayName: p.author.displayName, riotId: id ? `${id.gameName}#${id.tagLine}` : null, rank: id?.rank ?? null },
    video: p.clip ? { ready: p.clip.exportStatus === "READY", status: p.clip.exportStatus, durationSec: Math.round((p.clip.endMs - p.clip.startMs) / 1000) } : null,
    likes: p._count.likes,
    liked: p.likes.length > 0,
    comments: p._count.comments,
  };
}
export type PostDTO = ReturnType<typeof toDTO>;

export async function listPosts(userId: string, opts: { kind?: string; reels?: boolean; cursor?: string; take?: number } = {}) {
  const take = Math.min(30, opts.take ?? 20);
  const kind = (KINDS as readonly string[]).includes(opts.kind ?? "") ? (opts.kind as CommunityPostKind) : undefined;
  const posts = await prisma.communityPost.findMany({
    where: { ...visibleWhere(userId), ...(opts.reels ? { kind: "CLIP" as const, clip: { exportStatus: "READY" } } : kind ? { kind } : {}) },
    include: postInclude(userId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const page = posts.slice(0, take).map((p) => toDTO(userId, p));
  return { posts: page, nextCursor: posts.length > take ? page.at(-1)!.id : null };
}

export async function getPost(userId: string, id: string) {
  const p = await prisma.communityPost.findFirst({ where: { id, ...visibleWhere(userId) }, include: postInclude(userId) });
  if (!p) throw notFound("Publication");
  const comments = await prisma.communityComment.findMany({
    where: { postId: id, hiddenAt: null },
    include: { author: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return {
    post: toDTO(userId, p),
    comments: comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, mine: c.authorId === userId, author: c.author })),
  };
}

export async function toggleLike(userId: string, postId: string) {
  const post = await prisma.communityPost.findFirst({ where: { id: postId, ...visibleWhere(userId) }, select: { id: true } });
  if (!post) throw notFound("Publication");
  const existing = await prisma.communityLike.findUnique({ where: { postId_userId: { postId, userId } } });
  if (existing) await prisma.communityLike.delete({ where: { postId_userId: { postId, userId } } });
  else await prisma.communityLike.create({ data: { postId, userId } });
  return { liked: !existing, likes: await prisma.communityLike.count({ where: { postId } }) };
}

export async function addComment(userId: string, postId: string, raw: unknown) {
  const { body } = z.object({ body: z.string().trim().min(1).max(1000) }).parse(raw);
  const post = await prisma.communityPost.findFirst({ where: { id: postId, ...visibleWhere(userId) }, select: { id: true, authorId: true, title: true } });
  if (!post) throw notFound("Publication");
  const c = await prisma.communityComment.create({ data: { postId, authorId: userId, body } });
  if (post.authorId !== userId) {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    await notify(post.authorId, { type: "community_comment", title: "Nouveau commentaire", body: `${me.displayName} a commenté « ${post.title} ».`, link: `/app/community/${postId}` });
  }
  return c;
}

export async function deletePost(userId: string, id: string) {
  const p = await prisma.communityPost.findUnique({ where: { id }, select: { authorId: true } });
  if (!p) throw notFound("Publication");
  if (p.authorId !== userId && !(await isAdmin(userId))) throw notFound("Publication");
  await prisma.communityPost.delete({ where: { id } });
}

export async function deleteComment(userId: string, id: string) {
  const c = await prisma.communityComment.findUnique({ where: { id }, select: { authorId: true } });
  if (!c) throw notFound("Commentaire");
  if (c.authorId !== userId && !(await isAdmin(userId))) throw notFound("Commentaire");
  await prisma.communityComment.delete({ where: { id } });
}

export async function report(userId: string, raw: unknown) {
  const input = z.object({ targetType: z.enum(["POST", "COMMENT"]), targetId: z.string(), reason: z.string().trim().min(3).max(500) }).parse(raw);
  const exists =
    input.targetType === "POST"
      ? await prisma.communityPost.count({ where: { id: input.targetId } })
      : await prisma.communityComment.count({ where: { id: input.targetId } });
  if (!exists) throw notFound("Contenu");
  await prisma.communityReport.upsert({
    where: { reporterId_targetType_targetId: { reporterId: userId, targetType: input.targetType, targetId: input.targetId } },
    update: { reason: input.reason, resolvedAt: null },
    create: { reporterId: userId, ...input },
  });
}

/** Modération (administrateur) : masquer le contenu signalé ou classer le signalement. */
export async function moderate(adminId: string, reportId: string, action: "hide" | "dismiss") {
  if (!(await isAdmin(adminId))) throw new HttpError(403, "forbidden", "Réservé aux administrateurs.");
  const r = await prisma.communityReport.findUnique({ where: { id: reportId } });
  if (!r) throw notFound("Signalement");
  if (action === "hide") {
    if (r.targetType === "POST") await prisma.communityPost.updateMany({ where: { id: r.targetId }, data: { hiddenAt: new Date() } });
    else await prisma.communityComment.updateMany({ where: { id: r.targetId }, data: { hiddenAt: new Date() } });
  }
  await prisma.communityReport.updateMany({ where: { targetType: r.targetType, targetId: r.targetId, resolvedAt: null }, data: { resolvedAt: new Date() } });
}

/** Fichier vidéo d'un reel : le clip exporté uniquement, si la publication est visible. */
export async function reelVideoKey(userId: string, postId: string) {
  const p = await prisma.communityPost.findFirst({ where: { id: postId, ...visibleWhere(userId) }, include: { clip: { select: { exportKey: true, exportStatus: true } } } });
  if (!p?.clip?.exportKey || p.clip.exportStatus !== "READY") throw notFound("Vidéo");
  return p.clip.exportKey;
}
