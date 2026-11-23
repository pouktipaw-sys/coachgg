// Assistant de sélection des champions : quand ton champion est verrouillé, importe la page de runes et l'ensemble
// d'objets « méta » (serveur CoachGG) dans le client ; affiche les conseils (contres, bannissements) dans l'interface
// locale de l'agent. Ne fait rien en partie et n'agit jamais à ta place (pas de choix ni de verrouillage automatique).
import type { CoachApi } from "./api";
import type { AgentConfig } from "./config";
import { type Lcu, readChampSelect } from "./lcu";

type Advice = Awaited<ReturnType<CoachApi["draftAdvice"]>>["advice"];

export class ChampSelectAssistant {
  status: "client_closed" | "idle" | "in_champ_select" = "client_closed";
  message = "";
  advice: Advice = null;
  private applied: number | null = null; // champion pour lequel l'import a déjà été fait dans cette sélection
  private adviceKey = "";
  private adviceAt = 0;

  constructor(
    private cfg: AgentConfig,
    private api: CoachApi,
    private lcu: () => Lcu | null,
    private log: (m: string) => void = () => {},
  ) {}

  snapshot() {
    return { status: this.status, message: this.message, advice: this.advice };
  }

  async tick() {
    const lcu = this.lcu();
    if (!lcu) {
      this.status = "client_closed";
      this.message = "Client League of Legends fermé.";
      return;
    }
    const s = await lcu.champSelect();
    if (!s) {
      if (this.status === "in_champ_select") this.log("sélection des champions terminée");
      this.status = "idle";
      this.message = "En attente d'une sélection des champions.";
      this.applied = null;
      this.advice = null;
      this.adviceKey = "";
      return;
    }
    this.status = "in_champ_select";
    const info = readChampSelect(s);
    if (!this.cfg.deviceToken) {
      this.message = "Sélection en cours — appaire ce PC pour recevoir les runes et les conseils.";
      return;
    }
    // Conseils : recalculés quand la sélection change (au plus toutes les 5 s).
    const key = `${info.role}|${info.enemyLaner}|${info.taken.join(",")}`;
    if (info.role && key !== this.adviceKey && Date.now() - this.adviceAt > 5000) {
      this.adviceKey = key;
      this.adviceAt = Date.now();
      this.advice = (await this.api.draftAdvice(info.role, info.enemyLaner, info.taken).catch(() => ({ advice: null }))).advice;
    }
    if (!info.locked) {
      this.message = info.championId ? "Champion survolé : les runes seront importées quand tu le verrouilles." : "Choisis ton champion.";
      return;
    }
    if (this.applied === info.championId) return;
    this.applied = info.championId;
    const b = (await this.api.metaBuild(info.championId, info.role).catch(() => ({ build: null }))).build;
    if (!b) {
      this.message = "Pas encore de statistiques méta pour ce champion : runes non importées.";
      return;
    }
    const done: string[] = [];
    if (this.cfg.champSelect.importRunes && b.runes && (await lcu.applyRunes(b.runes, `CoachGG ${b.role} ${b.patch}`))) done.push("page de runes");
    if (this.cfg.champSelect.importItems && b.items.length) {
      const sid = await lcu.summonerId();
      if (sid && (await lcu.applyItemSet(sid, info.championId, `CoachGG ${b.role} (${b.patch})`, b.items.map((i) => i.itemId)))) done.push("ensemble d'objets");
    }
    const tips = [b.skillOrder ? `monte ${b.skillOrder.replace(/>/g, " › ")}` : null].filter(Boolean).join(" · ");
    this.message = (done.length ? `Importé dans le client : ${done.join(" et ")} (patch ${b.patch}, ${b.games} parties).` : "Import désactivé ou refusé par le client.") + (tips ? ` Conseil : ${tips}.` : "");
    this.log(this.message);
  }
}
