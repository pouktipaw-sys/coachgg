import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { AuthorLine, KIND_LABEL, LikeButton, NewPostForm, ReelsFeed, type PostDTO } from "@/components/community/CommunityBits";
import { requirePageUser } from "@/server/auth/page";
import { prisma } from "@/server/db";
import { listPosts } from "@/server/community";

export const metadata = { title: "Communauté" };

const TABS = [
  { key: "reels", label: "🎬 Reels" },
  { key: "forum", label: "💬 Forum" },
] as const;
const FILTERS = [
  { key: "", label: "Tout" },
  { key: "QUESTION", label: "❓ Conseils" },
  { key: "EXPLOIT", label: "🏆 Exploits" },
  { key: "DISCUSSION", label: "💬 Discussions" },
  { key: "CLIP", label: "🎬 Reels" },
];

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ tab?: string; kind?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const tab = sp.tab === "forum" ? "forum" : "reels";
  const plain = <T,>(x: unknown) => JSON.parse(JSON.stringify(x)) as T;
  const [feed, myClips] = await Promise.all([
    tab === "reels" ? listPosts(user.id, { reels: true, take: 10 }) : listPosts(user.id, { kind: sp.kind, take: 30 }),
    tab === "forum" ? prisma.clip.findMany({ where: { ownerId: user.id, recording: { ownerId: user.id } }, select: { id: true, title: true }, orderBy: { createdAt: "desc" }, take: 30 }) : [],
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Communauté" subtitle="Les meilleurs (et pires 😅) moments de la communauté, et un forum pour partager tes exploits ou demander des conseils." />
      <nav className="flex gap-2" aria-label="Sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/app/community?tab=${t.key}`} className={`rounded-full border px-4 py-1.5 text-sm ${tab === t.key ? "border-accent bg-accent/20" : "border-line text-muted"}`}>{t.label}</Link>
        ))}
      </nav>

      {tab === "reels" ? (
        <ReelsFeed initial={plain<PostDTO[]>(feed.posts)} nextCursor={feed.nextCursor} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <nav className="flex flex-wrap gap-1 text-xs" aria-label="Filtrer">
              {FILTERS.map((f) => (
                <Link key={f.key} href={`/app/community?tab=forum${f.key ? `&kind=${f.key}` : ""}`} className={`rounded-full border px-3 py-1 ${(sp.kind ?? "") === f.key ? "border-accent bg-accent/20" : "border-line text-muted"}`}>{f.label}</Link>
              ))}
            </nav>
            {feed.posts.length === 0 ? (
              <p className="card text-sm text-muted">Rien ici pour l&apos;instant. Lance la conversation !</p>
            ) : (
              <ul className="space-y-3" data-testid="forum">
                {plain<PostDTO[]>(feed.posts).map((p) => (
                  <li key={p.id} className="card space-y-2" data-testid="forum-post">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <AuthorLine post={p} />
                      <span className="badge text-xs">{KIND_LABEL[p.kind]}</span>
                    </div>
                    <Link href={`/app/community/${p.id}`} className="block">
                      <p className="font-semibold hover:underline">{p.title}</p>
                      {p.body && <p className="line-clamp-3 text-sm text-muted">{p.body}</p>}
                    </Link>
                    <div className="flex items-center gap-4 text-sm text-muted">
                      <LikeButton post={p} />
                      <Link href={`/app/community/${p.id}`} className="hover:text-text">💬 {p.comments}</Link>
                      {p.video && <span>🎬 {p.video.ready ? `clip ${p.video.durationSec} s` : "clip en préparation"}</span>}
                      <span className="ml-auto text-xs">{new Date(p.createdAt).toLocaleDateString("fr-FR")}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <h2 className="h2">Nouvelle publication</h2>
            <NewPostForm clips={myClips} />
          </div>
        </div>
      )}
    </div>
  );
}
