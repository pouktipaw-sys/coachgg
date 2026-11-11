"use client";
// Éléments interactifs de la communauté : j'aime, signalement, commentaire, nouvelle publication, reels.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client";
import { Avatar, RankChip } from "@/components/friends/FriendBits";

export type PostDTO = {
  id: string;
  kind: "CLIP" | "EXPLOIT" | "QUESTION" | "DISCUSSION";
  title: string;
  body: string;
  createdAt: string;
  mine: boolean;
  author: { id: string; displayName: string; riotId: string | null; rank: unknown };
  video: { ready: boolean; status: string | null; durationSec: number } | null;
  likes: number;
  liked: boolean;
  comments: number;
};

export const KIND_LABEL: Record<PostDTO["kind"], string> = { CLIP: "🎬 Reel", EXPLOIT: "🏆 Exploit", QUESTION: "❓ Conseil demandé", DISCUSSION: "💬 Discussion" };

export function LikeButton({ post, big = false }: { post: Pick<PostDTO, "id" | "likes" | "liked">; big?: boolean }) {
  const [s, setS] = useState({ liked: post.liked, likes: post.likes });
  return (
    <button
      className={`flex items-center gap-1 ${big ? "flex-col text-xs" : "text-sm"} ${s.liked ? "text-loss" : "text-muted hover:text-text"}`}
      aria-pressed={s.liked}
      aria-label={s.liked ? "Je n'aime plus" : "J'aime"}
      data-testid="like"
      onClick={async () => {
        setS((x) => ({ liked: !x.liked, likes: x.likes + (x.liked ? -1 : 1) })); // affichage immédiat
        try {
          setS(await api<{ liked: boolean; likes: number }>(`/api/community/posts/${post.id}/like`, { method: "POST" }));
        } catch {
          setS({ liked: post.liked, likes: post.likes });
        }
      }}
    >
      <span className={big ? "text-3xl" : ""}>{s.liked ? "♥" : "♡"}</span> {s.likes}
    </button>
  );
}

export function ReportButton({ targetType, targetId }: { targetType: "POST" | "COMMENT"; targetId: string }) {
  const [done, setDone] = useState(false);
  if (done) return <span className="text-xs text-muted">Signalé, merci.</span>;
  return (
    <button
      className="text-xs text-muted underline"
      onClick={async () => {
        const reason = window.prompt("Pourquoi signaler ce contenu ? (insulte, triche, contenu inapproprié…)");
        if (!reason || reason.trim().length < 3) return;
        try {
          await api("/api/community/reports", { method: "POST", json: { targetType, targetId, reason } });
          setDone(true);
        } catch (e) {
          alert(errorMessage(e));
        }
      }}
    >
      Signaler
    </button>
  );
}

export function AuthorLine({ post }: { post: PostDTO }) {
  return (
    <span className="flex items-center gap-2">
      <Avatar name={post.author.displayName} size={32} />
      <span className="leading-tight">
        <span className="font-medium">{post.author.displayName}</span>
        {post.author.riotId && <span className="block text-xs text-muted">{post.author.riotId}</span>}
      </span>
      <RankChip rank={post.author.rank as never} />
    </span>
  );
}

/** Fil de reels : défilement vertical, lecture automatique (sans son) de la vidéo à l'écran. */
export function ReelsFeed({ initial, nextCursor }: { initial: PostDTO[]; nextCursor: string | null }) {
  const [posts, setPosts] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [muted, setMuted] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target.querySelector("video");
          if (!v) continue;
          if (e.isIntersecting && e.intersectionRatio >= 0.6) void v.play().catch(() => {});
          else v.pause();
        }
      },
      { root: el, threshold: [0, 0.6, 1] },
    );
    el.querySelectorAll("[data-reel]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [posts]);

  async function more() {
    if (!cursor) return;
    const r = await api<{ posts: PostDTO[]; nextCursor: string | null }>(`/api/community/posts?reels=1&cursor=${cursor}`);
    setPosts((p) => [...p, ...r.posts]);
    setCursor(r.nextCursor);
  }

  if (!posts.length) return <p className="card text-sm text-muted">Pas encore de reel. Publie un de tes clips depuis la page Clips : « Publier en reel » !</p>;
  return (
    <div ref={root} className="mx-auto h-[calc(100vh-11rem)] max-w-md snap-y snap-mandatory overflow-y-auto rounded-2xl bg-black" data-testid="reels">
      {posts.map((p) => (
        <article key={p.id} data-reel className="relative flex h-full snap-start items-center justify-center" data-testid="reel">
          <video src={`/api/community/posts/${p.id}/video`} className="max-h-full w-full object-contain" loop playsInline muted={muted} preload="metadata" onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 pr-16">
            <div className="pointer-events-auto"><AuthorLine post={p} /></div>
            <p className="mt-2 font-semibold">{p.title}</p>
            {p.body && <p className="line-clamp-2 text-sm text-muted">{p.body}</p>}
          </div>
          <div className="absolute bottom-6 right-3 flex flex-col items-center gap-4">
            <LikeButton post={p} big />
            <Link href={`/app/community/${p.id}`} className="flex flex-col items-center text-xs text-muted hover:text-text" aria-label="Commentaires">
              <span className="text-3xl">💬</span>
              {p.comments}
            </Link>
            <button className="text-2xl" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Activer le son" : "Couper le son"}>{muted ? "🔇" : "🔊"}</button>
          </div>
        </article>
      ))}
      {cursor && (
        <div className="flex h-24 snap-start items-center justify-center">
          <button className="btn-ghost" onClick={more}>Voir plus de reels</button>
        </div>
      )}
    </div>
  );
}

export function NewPostForm({ clips }: { clips: { id: string; title: string }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<PostDTO["kind"]>("QUESTION");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="card space-y-3"
      data-testid="new-post"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        try {
          const r = await api<{ post: { id: string } }>("/api/community/posts", {
            method: "POST",
            json: { kind, title: f.get("title"), body: f.get("body"), clipId: f.get("clipId") || null },
          });
          form.reset();
          router.push(`/app/community/${r.post.id}`);
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <div className="flex flex-wrap gap-2">
        {(["QUESTION", "EXPLOIT", "DISCUSSION"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-sm ${kind === k ? "border-accent bg-accent/20" : "border-line text-muted"}`}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <input name="title" className="input" required minLength={3} maxLength={120} placeholder={kind === "QUESTION" ? "Ex. Comment jouer contre un Yasuo en mid ?" : kind === "EXPLOIT" ? "Ex. Pentakill au Baron 🔥" : "Titre"} aria-label="Titre" />
      <textarea name="body" className="input min-h-24" maxLength={4000} placeholder="Explique la situation, ton rôle, ton rang…" aria-label="Message" />
      {clips.length > 0 && (
        <select name="clipId" className="input" defaultValue="" aria-label="Joindre un clip">
          <option value="">Sans clip</option>
          {clips.map((c) => <option key={c.id} value={c.id}>🎬 {c.title}</option>)}
        </select>
      )}
      <div className="flex items-center gap-3">
        <button className="btn-primary">Publier</button>
        <p className="text-xs text-muted">Reste respectueux. Pas d&apos;insultes, de triche ni d&apos;informations personnelles.</p>
      </div>
      {msg && <p role="alert" className="text-sm text-loss">{msg}</p>}
    </form>
  );
}

export function CommentForm({ postId }: { postId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        try {
          await api(`/api/community/posts/${postId}/comments`, { method: "POST", json: { body: f.get("body") } });
          form.reset();
          router.refresh();
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <input name="body" className="input flex-1" required maxLength={1000} placeholder="Ton conseil ou ta réaction…" aria-label="Commentaire" data-testid="comment-input" />
      <button className="btn-primary">Envoyer</button>
      {msg && <p role="alert" className="text-sm text-loss">{msg}</p>}
    </form>
  );
}

export function PublishClipButton({ clipId, defaultTitle }: { clipId: string; defaultTitle: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        className="text-xs text-accent-2 underline"
        data-testid="publish-reel"
        onClick={async () => {
          const title = window.prompt("Titre du reel (visible par toute la communauté) :", defaultTitle);
          if (!title || title.trim().length < 3) return;
          try {
            const r = await api<{ post: { id: string } }>("/api/community/posts", { method: "POST", json: { kind: "CLIP", clipId, title } });
            setMsg("Publié ! Le reel apparaît dès que la vidéo annotée est prête.");
            router.push(`/app/community/${r.post.id}`);
          } catch (e) {
            setMsg(errorMessage(e));
          }
        }}
      >
        📤 Publier en reel
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
