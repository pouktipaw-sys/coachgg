"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client";
import { ROLE_LABELS } from "@/components/stats";

type Profile = {
  primaryRole: string | null;
  secondaryRole: string | null;
  favoriteChampions: string[];
  progressGoal: string | null;
  explanationLevel: string;
  explanationDensity: string;
  language: string;
  shareStatsWithTeams: boolean;
  retentionDays: number | null;
  autoClipDeaths: boolean;
  autoClipFights: boolean;
};

export function ProfileForm({ displayName, profile, onboarding = false }: { displayName: string; profile: Profile; onboarding?: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await api("/api/profile", {
            method: "PUT",
            json: {
              displayName: f.get("displayName"),
              primaryRole: f.get("primaryRole") || null,
              secondaryRole: f.get("secondaryRole") || null,
              favoriteChampions: String(f.get("favoriteChampions") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5),
              progressGoal: f.get("progressGoal") || null,
              explanationLevel: f.get("explanationLevel"),
              explanationDensity: f.get("explanationDensity"),
              language: f.get("language"),
              shareStatsWithTeams: f.get("shareStatsWithTeams") === "on",
              autoClipDeaths: f.get("autoClipDeaths") === "on",
              autoClipFights: f.get("autoClipFights") === "on",
              retentionDays: f.get("retentionDays") ? Number(f.get("retentionDays")) : null,
              completeOnboarding: onboarding || undefined,
            },
          });
          if (onboarding) router.push("/app");
          else setMsg("Profil enregistré.");
          router.refresh();
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="p-name">Pseudo CoachGG</label>
          <input id="p-name" name="displayName" className="input" defaultValue={displayName} required minLength={2} maxLength={40} />
        </div>
        <div>
          <label className="label" htmlFor="p-champs">Champions préférés (séparés par des virgules, 5 max)</label>
          <input id="p-champs" name="favoriteChampions" className="input" defaultValue={profile.favoriteChampions.join(", ")} />
        </div>
        <div>
          <label className="label" htmlFor="p-r1">Rôle principal</label>
          <select id="p-r1" name="primaryRole" className="input" defaultValue={profile.primaryRole ?? ""}>
            <option value="">—</option>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-r2">Rôle secondaire</label>
          <select id="p-r2" name="secondaryRole" className="input" defaultValue={profile.secondaryRole ?? ""}>
            <option value="">—</option>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="p-goal">Objectif de progression</label>
          <input id="p-goal" name="progressGoal" className="input" defaultValue={profile.progressGoal ?? ""} maxLength={300} placeholder="Ex. mieux gérer mes débuts de partie" />
        </div>
        <div>
          <label className="label" htmlFor="p-lvl">Niveau des explications</label>
          <select id="p-lvl" name="explanationLevel" className="input" defaultValue={profile.explanationLevel}>
            <option value="BEGINNER">Débutant</option>
            <option value="INTERMEDIATE">Intermédiaire</option>
            <option value="ADVANCED">Avancé</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-den">Densité des explications</label>
          <select id="p-den" name="explanationDensity" className="input" defaultValue={profile.explanationDensity}>
            <option value="concise">Concise</option>
            <option value="normal">Normale</option>
            <option value="detailed">Détaillée</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-lang">Langue</label>
          <select id="p-lang" name="language" className="input" defaultValue={profile.language}>
            <option value="fr">Français</option>
            <option value="en" disabled>English (bientôt)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-ret">Conservation des vidéos</label>
          <select id="p-ret" name="retentionDays" className="input" defaultValue={profile.retentionDays ?? ""}>
            <option value="">Jusqu&apos;à suppression manuelle</option>
            <option value="30">30 jours</option>
            <option value="90">90 jours</option>
            <option value="365">1 an</option>
          </select>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="shareStatsWithTeams" defaultChecked={profile.shareStatsWithTeams} className="mt-1" />
        <span>
          Partager mes statistiques détaillées avec mes groupes
          <span className="block text-xs text-muted">Les vidéos ne sont jamais partagées automatiquement, quel que soit ce réglage.</span>
        </span>
      </label>
      <fieldset className="space-y-2 rounded-lg border border-line p-3 text-sm">
        <legend className="px-1 text-xs text-muted">Analyse automatique après chaque import (expérimentale)</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="autoClipDeaths" defaultChecked={profile.autoClipDeaths} className="mt-1" data-testid="pref-auto-deaths" />
          <span>Découper chaque mort détectée en clip (contexte avant + 3 s après)</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="autoClipFights" defaultChecked={profile.autoClipFights} className="mt-1" />
          <span>
            Découper aussi les combats probables (forte activité à l&apos;écran)
            <span className="block text-xs text-muted">Détection approximative : certains clips seront de simples mouvements de caméra.</span>
          </span>
        </label>
      </fieldset>
      {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
      <button className="btn-primary">{onboarding ? "Terminer" : "Enregistrer"}</button>
    </form>
  );
}

export function IdentityForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const [gameName, tagLine] = String(f.get("riotId") ?? "").split("#");
        try {
          await api("/api/identities", { method: "POST", json: { gameName: gameName?.trim(), tagLine: tagLine?.trim(), platform: f.get("platform") } });
          form.reset();
          setMsg("Identité ajoutée (déclarée).");
          router.refresh();
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <div>
        <label className="label" htmlFor="i-id">Riot ID</label>
        <input id="i-id" name="riotId" className="input" placeholder="NomDeJeu#EUW" required pattern=".+#.+" />
      </div>
      <div>
        <label className="label" htmlFor="i-pl">Serveur</label>
        <select id="i-pl" name="platform" className="input" defaultValue="EUW1">
          {["EUW1", "EUN1", "NA1", "KR", "JP1", "BR1", "LA1", "LA2", "OC1", "TR1", "RU", "ME1", "SG2", "TW2", "VN2"].map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <button className="btn-primary">Associer</button>
      {msg && <p role="status" className="w-full text-xs text-muted">{msg}</p>}
    </form>
  );
}

export function DeleteAccountForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!confirm("Supprimer définitivement votre compte, vos vidéos, analyses et statistiques ?")) return;
        try {
          await api("/api/account", { method: "DELETE", json: { password: new FormData(e.currentTarget).get("password") } });
          router.push("/");
          router.refresh();
        } catch (err) {
          setMsg(errorMessage(err));
        }
      }}
    >
      <input name="password" type="password" className="input max-w-xs" placeholder="Mot de passe CoachGG" required aria-label="Mot de passe pour confirmer" autoComplete="current-password" />
      <button className="btn-danger">Supprimer mon compte</button>
      {msg && <p role="alert" className="text-xs text-loss">{msg}</p>}
    </form>
  );
}
