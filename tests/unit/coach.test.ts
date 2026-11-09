import { describe, expect, it } from "vitest";
import { answerWithRules, detectIntent } from "@/server/coach/rules";
import { computeCost, validateCitations } from "@/server/coach/llm";
import { renderSources, type CoachContext, type Source } from "@/server/coach/context";

const src = (id: string, kind: Source["kind"] = "match"): Source => ({ id, kind, title: id, link: `/x/${id}`, text: `texte ${id}` });

const ctx = (over: Partial<CoachContext> = {}): CoachContext => ({
  profile: { level: "INTERMEDIATE", density: "normal", primaryRole: "MIDDLE", goal: null, source: src("profile", "profile") },
  matches: [
    {
      source: src("match:m1"),
      date: new Date("2026-11-01"),
      champion: "Ahri",
      role: "MIDDLE",
      win: true,
      overall: 6.4,
      reliability: "high",
      components: [
        { key: "resources", label: "Ressources (farm)", available: true, score: 8, display: "8.0 CS/min" },
        { key: "vision", label: "Vision", available: true, score: 3, display: "0.40 /min" },
        { key: "risk", label: "Gestion du risque", available: true, score: 7, display: "1.0 morts/10 min" },
      ],
      positives: [],
      negatives: [],
      missing: [],
    },
  ],
  moments: [],
  goals: [],
  trend: null,
  teams: [],
  ...over,
});

describe("coach — mode règles", () => {
  it("reconnaît les questions types", () => {
    expect(detectIntent("Pourquoi cette note ?")).toBe("why_score");
    expect(detectIntent("Quelles erreurs de placement ?")).toBe("positioning");
    expect(detectIntent("Quelle meilleure action ?")).toBe("best_action");
    expect(detectIntent("Pourquoi cette trajectoire ?")).toBe("trajectory");
    expect(detectIntent("Que travailler ensuite ?")).toBe("next_focus");
    expect(detectIntent("Que doit améliorer notre groupe ?")).toBe("group");
    expect(detectIntent("Quel temps fait-il ?")).toBe("unknown");
  });

  it("explique la note en citant le match, sans évoquer le résultat comme facteur", () => {
    const a = answerWithRules("Pourquoi cette note ?", ctx());
    expect(a.answer).toMatch(/6.4\/10/);
    expect(a.answer).toMatch(/Ressources/);
    expect(a.answer).toMatch(/Vision/);
    expect(a.answer).toMatch(/résultat du match n'en fait pas partie/);
    expect(a.citations).toEqual([{ sourceId: "match:m1" }]);
  });

  it("refuse de déduire une erreur de placement des statistiques seules", () => {
    const a = answerWithRules("Quelles erreurs de placement ?", ctx());
    expect(a.citations).toEqual([]);
    expect(a.answer).toMatch(/statistiques seules ne permettent pas/);
    expect(a.missingInformation.length).toBeGreaterThan(0);
  });

  it("cite les moments vidéo pour le placement et les alternatives", () => {
    const moment = { source: src("moment:r1", "moment"), kind: "MISTAKE", category: "POSITIONING", title: "Avancée sans vision", advice: "Reste derrière ta vague", confidence: "MEDIUM", alternatives: [{ label: "Reculer", conditions: "jungle inconnue", limits: "" }], hasAlternativePath: true, hasActualPath: true };
    const c = ctx({ moments: [moment] });
    expect(answerWithRules("Quelles erreurs de placement ?", c).citations).toEqual([{ sourceId: "moment:r1" }]);
    const b = answerWithRules("Quelle meilleure action ?", c);
    expect(b.answer).toMatch(/propositions, pas des certitudes/);
    expect(b.answer).toMatch(/Reculer \(si jungle inconnue\)/);
    expect(answerWithRules("Pourquoi cette trajectoire ?", c).answer).toMatch(/alternative en vert/);
  });

  it("signale l'absence de partie commune et ne prétend pas connaître le vocal", () => {
    expect(answerWithRules("Que doit améliorer notre groupe ?", ctx()).missingInformation[0]).toMatch(/Aucune partie commune/);
    const t = { source: src("team:t1:m1", "team_match"), teamName: "Duo", mvpText: "Ana obtient la meilleure note.", problem: "Vision : moyenne 3/10", goal: "Préparer la vision.", sequenceLink: null };
    const a = answerWithRules("Que doit améliorer notre groupe ?", ctx({ teams: [t] }));
    expect(a.answer).toMatch(/ne connais pas vos communications vocales/);
    expect(a.citations).toEqual([{ sourceId: "team:t1:m1" }]);
  });

  it("dit explicitement quand l'information manque", () => {
    const a = answerWithRules("Pourquoi cette note ?", ctx({ matches: [] }));
    expect(a.missingInformation[0]).toMatch(/Aucun match/);
  });
});

describe("coach — garde-fous du mode IA", () => {
  it("retire les citations inventées et dédoublonne", () => {
    const r = validateCitations([{ sourceId: "match:m1" }, { sourceId: "match:inventé" }, { sourceId: "match:m1" }], [src("match:m1")]);
    expect(r.valid.map((v) => v.sourceId)).toEqual(["match:m1"]);
    expect(r.invalid).toEqual(["match:inventé"]);
    expect(r.valid[0]!.link).toBe("/x/match:m1");
  });

  it("calcule le coût à partir de l'usage réel (Claude Opus 5.5)", () => {
    // 1000 entrée × 4 + 500 sortie × 20 + 10 000 cache lu × 0,2 + 2000 cache écrit × 5 = 26 000 µ$
    expect(computeCost("claude-opus-5-5", { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000 })).toBe(26_000);
    expect(computeCost("modele-inconnu", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });

  it("délimite les données et neutralise les guillemets des titres", () => {
    const out = renderSources([{ ...src("moment:x", "moment"), title: 'Titre "piégé"' }]);
    expect(out.startsWith("<donnees_autorisees>")).toBe(true);
    expect(out).toContain(`titre="Titre 'piégé'"`);
  });
});
