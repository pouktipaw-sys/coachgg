"use client";
// Saisie manuelle d'un match à partir de l'écran de fin de partie.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";
import { MODE_LABELS, ROLE_LABELS } from "@/components/stats";

type Row = {
  isMe: boolean;
  riotGameName: string;
  riotTagLine: string;
  championName: string;
  role: string;
  teamSide: 100 | 200;
  kills: string;
  deaths: string;
  assists: string;
  creepScore: string;
  goldEarned: string;
  damageToChampions: string;
  damageToObjectives: string;
  visionScore: string;
};

const emptyRow = (isMe: boolean, side: 100 | 200 = 100, id?: { gameName: string; tagLine: string } | null, role = ""): Row => ({
  isMe,
  riotGameName: id?.gameName ?? "",
  riotTagLine: id?.tagLine ?? "",
  championName: "",
  role,
  teamSide: side,
  kills: "",
  deaths: "",
  assists: "",
  creepScore: "",
  goldEarned: "",
  damageToChampions: "",
  damageToObjectives: "",
  visionScore: "",
});

const STAT_FIELDS = [
  ["kills", "Éliminations"],
  ["deaths", "Morts"],
  ["assists", "Assistances"],
  ["creepScore", "CS"],
  ["goldEarned", "Or"],
  ["damageToChampions", "Dégâts aux champions"],
  ["damageToObjectives", "Dégâts aux objectifs"],
  ["visionScore", "Score de vision"],
] as const;

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function ManualMatchForm({ identity, primaryRole }: { identity: { gameName: string; tagLine: string } | null; primaryRole: string | null }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([emptyRow(true, 100, identity, primaryRole ?? "")]);
  const [mode, setMode] = useState("RANKED_SOLO");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [duration, setDuration] = useState("");
  const [win, setWin] = useState(true);
  const [totals, setTotals] = useState({ kills: "", damageToChampions: "", damageToObjectives: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upd = (i: number, k: keyof Row, v: string) => setRows((s) => s.map((r, j) => (j === i ? { ...r, [k]: k === "teamSide" ? (Number(v) as 100 | 200) : v } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const m = duration.match(/^(\d{1,3}):(\d{2})$/);
    if (!m) return setError("Durée attendue au format mm:ss (ex. 31:42).");
    const durationSec = Number(m[1]) * 60 + Number(m[2]);
    const meSide = rows.find((r) => r.isMe)!.teamSide;
    setBusy(true);
    try {
      const body = {
        gameStartAt: date ? new Date(date).toISOString() : null,
        durationSec,
        gameMode: mode,
        participants: rows.map((r) => ({
          isMe: r.isMe,
          riotGameName: r.riotGameName || null,
          riotTagLine: r.riotTagLine || null,
          championName: r.championName,
          role: r.role || null,
          teamSide: r.teamSide,
          win: r.teamSide === meSide ? win : !win,
          kills: Number(r.kills || 0),
          deaths: Number(r.deaths || 0),
          assists: Number(r.assists || 0),
          creepScore: num(r.creepScore),
          goldEarned: num(r.goldEarned),
          damageToChampions: num(r.damageToChampions),
          damageToObjectives: num(r.damageToObjectives),
          visionScore: num(r.visionScore),
        })),
        teamTotals: {
          [String(meSide)]: { kills: num(totals.kills), damageToChampions: num(totals.damageToChampions), damageToObjectives: num(totals.damageToObjectives) },
        },
      };
      const r = await api<{ match: { id: string } }>("/api/matches", { method: "POST", json: body });
      router.push(`/app/matches/${r.match.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const cell = "input px-2 py-1.5 text-xs";

  return (
    <form onSubmit={submit} className="card space-y-5" aria-label="Saisie manuelle d'un match">
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="mm-date">Date</label>
          <input id="mm-date" type="datetime-local" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="mm-dur">Durée (mm:ss)</label>
          <input id="mm-dur" className="input" placeholder="31:42" value={duration} onChange={(e) => setDuration(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="mm-mode">Mode</label>
          <select id="mm-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <span className="label">Résultat de mon équipe</span>
          <div className="flex gap-2">
            <button type="button" aria-pressed={win} className={`btn-ghost flex-1 ${win ? "border-win text-win" : ""}`} onClick={() => setWin(true)}>Victoire</button>
            <button type="button" aria-pressed={!win} className={`btn-ghost flex-1 ${!win ? "border-loss text-loss" : ""}`} onClick={() => setWin(false)}>Défaite</button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="p-1">Joueur</th><th className="p-1">Riot ID</th><th className="p-1">#Tag</th><th className="p-1">Champion*</th><th className="p-1">Rôle</th><th className="p-1">Équipe</th>
              <th className="p-1">K*</th><th className="p-1">D*</th><th className="p-1">A*</th><th className="p-1">CS</th><th className="p-1">Or</th><th className="p-1">Dégâts champ.</th><th className="p-1">Dégâts obj.</th><th className="p-1">Vision</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="p-1 whitespace-nowrap">{r.isMe ? <strong>Moi</strong> : `Joueur ${i + 1}`}</td>
                <td className="p-1"><input className={cell} aria-label="Riot ID" value={r.riotGameName} onChange={(e) => upd(i, "riotGameName", e.target.value)} /></td>
                <td className="p-1 w-16"><input className={cell} aria-label="Tag" value={r.riotTagLine} onChange={(e) => upd(i, "riotTagLine", e.target.value)} /></td>
                <td className="p-1"><input className={cell} aria-label="Champion" value={r.championName} onChange={(e) => upd(i, "championName", e.target.value)} required /></td>
                <td className="p-1">
                  <select className={cell} aria-label="Rôle" value={r.role} onChange={(e) => upd(i, "role", e.target.value)}>
                    <option value="">?</option>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="p-1">
                  <select className={cell} aria-label="Équipe" value={r.teamSide} onChange={(e) => upd(i, "teamSide", e.target.value)}>
                    <option value={100}>Bleue</option><option value={200}>Rouge</option>
                  </select>
                </td>
                {STAT_FIELDS.map(([k, label]) => (
                  <td key={k} className="p-1 w-20">
                    <input className={cell} inputMode="numeric" pattern="\d*" aria-label={label} value={r[k]} onChange={(e) => upd(i, k, e.target.value)}
                      required={["kills", "deaths", "assists"].includes(k)} />
                  </td>
                ))}
                <td className="p-1">
                  {!r.isMe && <button type="button" className="text-loss" aria-label="Retirer le joueur" onClick={() => setRows((s) => s.filter((_, j) => j !== i))}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length < 10 && (
        <button type="button" className="btn-ghost" onClick={() => setRows((s) => [...s, emptyRow(false, rows[0]!.teamSide)])}>
          + Ajouter un joueur (ami ou autre)
        </button>
      )}

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="label sm:col-span-3">Totaux de mon équipe (facultatif — calculés automatiquement si les 5 joueurs sont saisis)</legend>
        <input className="input" placeholder="Éliminations de l'équipe" aria-label="Éliminations de l'équipe" inputMode="numeric" value={totals.kills} onChange={(e) => setTotals({ ...totals, kills: e.target.value })} />
        <input className="input" placeholder="Dégâts aux champions de l'équipe" aria-label="Dégâts aux champions de l'équipe" inputMode="numeric" value={totals.damageToChampions} onChange={(e) => setTotals({ ...totals, damageToChampions: e.target.value })} />
        <input className="input" placeholder="Dégâts aux objectifs de l'équipe" aria-label="Dégâts aux objectifs de l'équipe" inputMode="numeric" value={totals.damageToObjectives} onChange={(e) => setTotals({ ...totals, damageToObjectives: e.target.value })} />
      </fieldset>
      <p className="text-xs text-muted">
        Les champs vides sont enregistrés comme « non disponibles » (jamais comme 0) et la note l&apos;indique.
        Un ami est relié à son compte CoachGG si son Riot ID correspond à celui déclaré dans son profil et que vous partagez un groupe.
      </p>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer le match"}</button>
    </form>
  );
}
