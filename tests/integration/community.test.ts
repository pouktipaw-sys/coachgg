// Communauté : reels (clip exporté uniquement), forum, j'aime, commentaires, signalement, modération.
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addComment, createPost, deletePost, getPost, listPosts, moderate, reelVideoKey, report, toggleLike } from "@/server/community";
import { makeUser } from "./helpers";

async function clipOf(ownerId: string, recOwnerId = ownerId, exportStatus: string | null = "READY") {
  const rec = await prisma.recording.create({ data: { ownerId: recOwnerId, title: "v", originalFilename: "v.mp4", declaredMime: "", sizeBytes: 10n, originalKey: "k", playbackKey: "p", status: "READY", durationMs: 60_000 } });
  return prisma.clip.create({ data: { recordingId: rec.id, ownerId, title: "Pentakill", kind: "GOOD_ACTION", startMs: 1000, endMs: 9000, exportStatus, exportKey: exportStatus === "READY" ? "exports/x.mp4" : null } });
}

describe("communauté", () => {
  it("forum : publier, aimer, commenter (notification), supprimer", async () => {
    const ana = await makeUser("Ana");
    const bob = await makeUser("Bob");
    const q = await createPost(ana.id, { kind: "QUESTION", title: "Comment jouer contre Yasuo ?", body: "Je suis Ahri mid, Argent." });
    expect((await listPosts(bob.id, { kind: "QUESTION" })).posts.map((p) => p.title)).toEqual(["Comment jouer contre Yasuo ?"]);
    expect(await toggleLike(bob.id, q.id)).toEqual({ liked: true, likes: 1 });
    expect(await toggleLike(bob.id, q.id)).toEqual({ liked: false, likes: 0 });
    await addComment(bob.id, q.id, { body: "Attends qu'il utilise son vent avant d'utiliser tes sorts." });
    expect(await prisma.notification.count({ where: { userId: ana.id, type: "community_comment" } })).toBe(1);
    const detail = await getPost(ana.id, q.id);
    expect(detail.post).toMatchObject({ comments: 1, mine: true });
    expect(detail.comments[0]!.author.displayName).toBe("Bob");
    await expect(deletePost(bob.id, q.id)).rejects.toMatchObject({ status: 404 }); // pas l'auteur
    await deletePost(ana.id, q.id);
    expect(await prisma.communityPost.count()).toBe(0);
    await expect(createPost(ana.id, { kind: "QUESTION", title: "x" })).rejects.toThrow();
  });

  it("reels : uniquement le clip exporté, de ses propres vidéos ; visible des autres une fois prêt", async () => {
    const ana = await makeUser("Ana");
    const bob = await makeUser("Bob");
    const ready = await clipOf(ana.id);
    const reel = await createPost(ana.id, { kind: "CLIP", title: "Pentakill 🔥", clipId: ready.id });
    expect(await reelVideoKey(bob.id, reel.id)).toBe("exports/x.mp4"); // jamais la clé de la vidéo complète
    expect((await listPosts(bob.id, { reels: true })).posts).toHaveLength(1);

    const pending = await clipOf(ana.id, ana.id, null);
    const p2 = await createPost(ana.id, { kind: "CLIP", title: "En cours", clipId: pending.id });
    expect((await prisma.clip.findUniqueOrThrow({ where: { id: pending.id } })).exportStatus).toBe("PENDING"); // export lancé
    expect((await listPosts(bob.id, {})).posts.map((p) => p.id)).not.toContain(p2.id);
    expect((await listPosts(ana.id, {})).posts.map((p) => p.id)).toContain(p2.id); // l'auteur le voit
    await expect(reelVideoKey(bob.id, p2.id)).rejects.toMatchObject({ status: 404 });

    // Clip d'une vidéo qu'un ami a partagée : interdit
    const sharedClip = await clipOf(bob.id, ana.id);
    await expect(createPost(bob.id, { kind: "CLIP", title: "Pas à moi", clipId: sharedClip.id })).rejects.toMatchObject({ status: 403 });
    await expect(createPost(bob.id, { kind: "CLIP", title: "Pas mon clip", clipId: ready.id })).rejects.toMatchObject({ status: 404 });

    // Supprimer le clip retire le reel
    await prisma.clip.delete({ where: { id: ready.id } });
    await expect(reelVideoKey(bob.id, reel.id)).rejects.toMatchObject({ status: 404 });
  });

  it("signalement puis modération : le contenu masqué disparaît pour tout le monde", async () => {
    const ana = await makeUser("Ana");
    const bob = await makeUser("Bob");
    const admin = await makeUser("Admin");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const post = await createPost(ana.id, { kind: "DISCUSSION", title: "Message insultant" });
    await report(bob.id, { targetType: "POST", targetId: post.id, reason: "insultes" });
    await report(bob.id, { targetType: "POST", targetId: post.id, reason: "insultes encore" }); // pas de doublon
    const [r] = await prisma.communityReport.findMany();
    expect(await prisma.communityReport.count()).toBe(1);
    await expect(moderate(bob.id, r!.id, "hide")).rejects.toMatchObject({ status: 403 });
    await moderate(admin.id, r!.id, "hide");
    expect((await listPosts(ana.id, {})).posts).toHaveLength(0);
    await expect(getPost(bob.id, post.id)).rejects.toMatchObject({ status: 404 });
    expect((await prisma.communityReport.findUniqueOrThrow({ where: { id: r!.id } })).resolvedAt).not.toBeNull();
  });
});
