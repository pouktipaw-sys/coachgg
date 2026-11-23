"use client";
// Grille des champions avec recherche instantanée et filtre par classe.
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useMemo, useState } from "react";

type C = { id: string; name: string; title: string; tags: string[]; image: string; mine: number };
const TAGS: Record<string, string> = { Fighter: "Combattant", Tank: "Tank", Mage: "Mage", Assassin: "Assassin", Marksman: "Tireur", Support: "Soutien" };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function ChampionGrid({ champions, version }: { champions: C[]; version: string }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [mine, setMine] = useState(false);
  const list = useMemo(
    () => champions.filter((c) => (!q || norm(c.name).includes(norm(q))) && (!tag || c.tags.includes(tag)) && (!mine || c.mine > 0)),
    [champions, q, tag, mine],
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Chercher un champion…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher un champion" />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Classe">
          {["", ...Object.keys(TAGS)].map((t) => (
            <button key={t || "all"} type="button" aria-pressed={tag === t} onClick={() => setTag(t)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${tag === t ? "border-accent bg-accent/20 text-white" : "border-line text-muted hover:text-text"}`}>
              {t ? TAGS[t] : "Tous"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Joués par moi
        </label>
      </div>
      <p className="text-xs text-muted">{list.length} champion(s)</p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8" data-testid="champion-grid">
        {list.map((c) => (
          <li key={c.id}>
            <Link href={`/app/champions/${c.id}`} className="card-hover group flex flex-col items-center gap-1.5 rounded-xl border border-line/70 bg-bg/40 p-2 text-center">
              <img src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.image}`} alt="" width={56} height={56} loading="lazy" className="rounded-lg border border-line/70 transition-transform group-hover:scale-105" />
              <span className="w-full truncate text-xs font-medium">{c.name}</span>
              {c.mine > 0 && <span className="rounded-full bg-accent/20 px-1.5 text-[10px] text-accent-2">{c.mine} partie(s)</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
