import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { AuthorLine, CommentForm, LikeButton, ReportButton, type PostDTO } from "@/components/community/CommunityBits";
import { Avatar } from "@/components/friends/FriendBits";
import { requirePageUser } from "@/server/auth/page";
import { KIND_LABEL } from "@/lib/community";
import { HttpError } from "@/server/errors";
import { getPost } from "@/server/community";

export const metadata = { title: "Communauté" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  let data;
  try {
    data = await getPost(user.id, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const p = JSON.parse(JSON.stringify(data.post)) as PostDTO;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/app/community?tab=${p.kind === "CLIP" ? "reels" : "forum"}`} className="text-sm text-muted hover:text-text">← Communauté</Link>
      <article className="card space-y-3" data-testid="post">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AuthorLine post={p} />
          <span className="badge text-xs">{KIND_LABEL[p.kind]}</span>
        </div>
        <h1 className="h1">{p.title}</h1>
        {p.video &&
          (p.video.ready ? (
            <video controls playsInline className="max-h-[70vh] w-full rounded-lg bg-black" src={`/api/community/posts/${p.id}/video`} data-testid="post-video" />
          ) : (
            <p className="rounded-lg bg-panel-2 p-3 text-sm text-muted">🎬 Vidéo annotée en préparation : la publication sera visible de tous dès qu&apos;elle est prête.</p>
          ))}
        {p.body && <p className="whitespace-pre-wrap text-sm">{p.body}</p>}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <LikeButton post={p} />
          <span className="text-muted">💬 {p.comments}</span>
          <span className="text-xs text-muted">{new Date(p.createdAt).toLocaleString("fr-FR")}</span>
          <span className="ml-auto flex gap-3">
            {p.mine ? (
              <ActionButton url={`/api/community/posts/${p.id}`} method="DELETE" label="Supprimer" className="text-xs text-loss underline" confirmText="Supprimer cette publication ?" redirectTo="/app/community?tab=forum" />
            ) : (
              <ReportButton targetType="POST" targetId={p.id} />
            )}
          </span>
        </div>
      </article>

      <section className="card space-y-3">
        <h2 className="h2">{data.comments.length} commentaire(s)</h2>
        <ul className="space-y-3" data-testid="comments">
          {data.comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.author.displayName} size={28} />
              <div className="flex-1">
                <p className="text-sm"><strong>{c.author.displayName}</strong> <span className="text-xs text-muted">{new Date(c.createdAt).toLocaleString("fr-FR")}</span></p>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                <p className="mt-0.5">
                  {c.mine ? (
                    <ActionButton url={`/api/community/comments/${c.id}`} method="DELETE" label="Supprimer" className="text-xs text-muted underline" />
                  ) : (
                    <ReportButton targetType="COMMENT" targetId={c.id} />
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <CommentForm postId={p.id} />
      </section>
    </div>
  );
}
