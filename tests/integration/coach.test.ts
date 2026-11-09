import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { allSources, buildCoachContext, renderSources } from "@/server/coach/context";
import { ask, createThread, getThread, reportMessage } from "@/server/coach/service";
import { createManualMatch } from "@/server/matches/service";
import { createTeam, leaveTeam } from "@/server/teams/service";
import { progressProfile, sendWeeklyReviews, weeklyReview } from "@/server/progress";
import { makeUser } from "./helpers";

async function recordingWithMoment(ownerId: string, title: string, status: "PUBLISHED" | "DRAFT" = "PUBLISHED") {
  const rec = await prisma.recording.create({
    data: { ownerId, title: `Vidéo ${title}`, originalFilename: "x.mp4", declaredMime: "", sizeBytes: 10n, originalKey: "k", status: "READY", durationMs: 60_000, gameStartOffsetMs: 5000 },
  });
  const r = await prisma.recommendation.create({
    data: {
      recordingId: rec.id, kind: "MISTAKE", category: "POSITIONING", title, contextStartMs: 10_000, slowdownStartMs: 15_000, decisionMs: 20_000, endMs: 25_000,
      interpretation: "Risque d'embuscade.", alternatives: [{ label: "Reculer", conditions: "jungle inconnue", limits: "moins de pression" }],
      confidence: "MEDIUM", confidenceReason: "Position adverse inconnue", advice: "Reste derrière ta vague.", status,
      provenance: status === "DRAFT" ? "AUTOMATIC" : "MANUAL",
      observations: { create: [{ text: `Observation ${title}`, source: "video", provenance: "MANUAL" }] },
    },
  });
  return { rec, r };
}

const match = (overrides: { visionScore?: number; riotGameName?: string } = {}) => ({
  durationSec: 1800,
  gameMode: "NORMAL" as const,
  participants: [{ isMe: true, riotGameName: overrides.riotGameName ?? null, riotTagLine: overrides.riotGameName ? "EUW" : null, championName: "Ahri", role: "MIDDLE" as const, teamSide: 100 as const, win: true, kills: 6, deaths: 3, assists: 8, creepScore: 230, damageToChampions: 22000, damageToObjectives: 6000, visionScore: overrides.visionScore ?? 25 }],
  teamTotals: { "100": { kills: 22, damageToChampions: 90000, damageToObjectives: 30000 } },
});

/** Client Anthropic réel (SDK) branché sur un faux serveur : on inspecte la requête et on choisit la réponse. */
function fakeClaude(reply: (body: Record<string, unknown>) => { status?: number; json: unknown }) {
  const calls: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
      const r = reply(body);
      return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json", "request-id": "req_test" } });
    }) as typeof fetch,
  });
  return { client, calls };
}

const messageJson = (payload: unknown, stop_reason = "end_turn") => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: JSON.stringify(payload) }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 800, output_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
});

describe("contexte du coach : uniquement les données autorisées", () => {
  it("inclut ses matchs et moments publiés, exclut brouillons, vidéos non partagées et données des autres", async () => {
    const ana = await makeUser("Ana");
    const bob = await makeUser("Bob");
    await createManualMatch(ana.id, match());
    await createManualMatch(bob.id, match({ visionScore: 99 }));
    const { r: own } = await recordingWithMoment(ana.id, "Ana publié");
    const { r: draft } = await recordingWithMoment(ana.id, "Ana brouillon", "DRAFT");
    const { rec: bobRec, r: bobPrivate } = await recordingWithMoment(bob.id, "Bob privé");

    let ids = allSources(await buildCoachContext(ana.id)).map((s) => s.id);
    expect(ids).toContain(`moment:${own.id}`);
    expect(ids).not.toContain(`moment:${draft.id}`); // proposition non validée
    expect(ids).not.toContain(`moment:${bobPrivate.id}`); // vidéo d'un autre, non partagée
    expect(ids.filter((i) => i.startsWith("match:"))).toHaveLength(1);
    expect(renderSources(allSources(await buildCoachContext(ana.id)))).not.toContain("vision 99");

    // Partage explicite → visible ; même groupe sans partage → invisible
    const team = await createTeam(bob.id, { name: "Duo" });
    await prisma.teamMembership.create({ data: { teamId: team.id, userId: ana.id } });
    ids = allSources(await buildCoachContext(ana.id)).map((s) => s.id);
    expect(ids).not.toContain(`moment:${bobPrivate.id}`);
    await prisma.sharePermission.create({ data: { recordingId: bobRec.id, grantedById: bob.id, granteeTeamId: team.id } });
    const shared = await buildCoachContext(ana.id);
    expect(shared.moments.find((m) => m.source.id === `moment:${bobPrivate.id}`)?.source.text).toMatch(/partagée par Bob/);
    await leaveTeam(ana.id, team.id); // départ : accès retiré
    expect(allSources(await buildCoachContext(ana.id)).map((s) => s.id)).not.toContain(`moment:${bobPrivate.id}`);
  });

  it("produit un texte identique pour des données identiques (cache de prompt)", async () => {
    const ana = await makeUser("Ana");
    await createManualMatch(ana.id, match());
    await recordingWithMoment(ana.id, "M");
    const a = renderSources(allSources(await buildCoachContext(ana.id)));
    const b = renderSources(allSources(await buildCoachContext(ana.id)));
    expect(a).toBe(b);
  });

  it("inclut le dernier rapport des groupes dont l'utilisateur est membre", async () => {
    const ana = await makeUser("Ana");
    const bob = await makeUser("Bob");
    await prisma.gameIdentity.create({ data: { userId: bob.id, gameName: "BobGG", tagLine: "EUW", platform: "EUW1" } });
    const team = await createTeam(ana.id, { name: "Les potes" });
    await prisma.teamMembership.create({ data: { teamId: team.id, userId: bob.id } });
    const m = match();
    await createManualMatch(ana.id, { ...m, participants: [...m.participants, { ...m.participants[0]!, isMe: false, riotGameName: "BobGG", riotTagLine: "EUW", championName: "Vi", role: "JUNGLE" as const }] });
    const ctx = await buildCoachContext(ana.id);
    expect(ctx.teams[0]?.source.text).toMatch(/Les potes/);
    expect(ctx.teams[0]?.source.text).toMatch(/MVP du groupe/);
    const outsider = await makeUser("Out");
    expect((await buildCoachContext(outsider.id)).teams).toHaveLength(0);
  });
});

describe("conversation avec le coach", () => {
  it("mode sans IA : réponse sourcée, enregistrée, privée", async () => {
    const ana = await makeUser("Ana");
    const eve = await makeUser("Eve");
    await createManualMatch(ana.id, match());
    const t = await createThread(ana.id, {});
    const msg = await ask(ana.id, t.id, { content: "Pourquoi cette note ?" });
    expect(msg.mode).toBe("rules");
    expect((msg.citations as { sourceId: string; link: string }[])[0]!.link).toMatch(/^\/app\/matches\//);
    expect(msg.costMicros).toBeNull();
    const thread = await getThread(ana.id, t.id);
    expect(thread.thread.title).toBe("Pourquoi cette note ?");
    expect(thread.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    await expect(getThread(eve.id, t.id)).rejects.toMatchObject({ status: 404 });
    await expect(ask(eve.id, t.id, { content: "Pourquoi ?" })).rejects.toMatchObject({ status: 404 });
    await reportMessage(ana.id, msg.id, "La note est fausse");
    expect((await prisma.coachMessage.findUniqueOrThrow({ where: { id: msg.id } })).reportComment).toBe("La note est fausse");
  });

  it("mode IA : requête conforme (modèle, repli, cache, format), citations inventées retirées, coût enregistré", async () => {
    const ana = await makeUser("Ana");
    await createManualMatch(ana.id, match());
    const matchId = (await prisma.match.findFirstOrThrow()).id;
    const { client, calls } = fakeClaude(() => ({
      json: messageJson({
        answer: "Votre note de 6,4 vient surtout de votre farm élevé et de votre vision faible.",
        citations: [{ sourceId: `match:${matchId}`, quote: "CS 230" }, { sourceId: "match:invente", quote: "" }],
        missingInformation: [],
        followUps: ["Que travailler ensuite ?"],
      }),
    }));
    const t = await createThread(ana.id, {});
    const msg = await ask(ana.id, t.id, { content: "Pourquoi cette note ?" }, { client });
    expect(msg.mode).toBe("llm");
    expect(msg.model).toBe("claude-opus-5-5");
    expect((msg.citations as { sourceId: string }[]).map((c) => c.sourceId)).toEqual([`match:${matchId}`]);
    expect(msg.warning).toMatch(/1 référence\(s\) inexistante\(s\) retirée/);
    expect(msg.costMicros).toBe(800 * 4 + 300 * 20 + 4000 * 0.2);
    expect(msg.cacheReadTokens).toBe(4000);

    const req = calls[0]!;
    expect(req.body.model).toBe("claude-opus-5-5");
    expect(req.body.fallbacks).toBe("default");
    expect(req.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect((req.body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect((req.body.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    const first = (req.body.messages as { content: { text: string; cache_control?: unknown }[] }[])[0]!;
    expect(first.content[0]!.text).toContain("<donnees_autorisees>");
    expect(first.content[0]!.cache_control).toEqual({ type: "ephemeral" });

    // 2e tour : l'historique est renvoyé après le bloc de données (préfixe stable)
    await ask(ana.id, t.id, { content: "Et ensuite ?" }, { client });
    const second = calls[1]!.body.messages as { role: string; content: unknown }[];
    expect(second[0]!.content).toEqual((calls[0]!.body.messages as { content: unknown }[])[0]!.content);
    expect(second.map((m) => m.role)).toEqual(["user", "user", "assistant", "user"]);
  });

  it("refus ou panne de l'IA : repli sur le mode sans IA, signalé", async () => {
    const ana = await makeUser("Ana");
    await createManualMatch(ana.id, match());
    const t = await createThread(ana.id, {});
    const refusal = fakeClaude(() => ({ json: { ...messageJson({}), content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } } }));
    const m1 = await ask(ana.id, t.id, { content: "Pourquoi cette note ?" }, { client: refusal.client });
    expect(m1.mode).toBe("llm_fallback_rules");
    expect(m1.warning).toMatch(/refusé/);
    expect((m1.citations as unknown[]).length).toBe(1);

    const down = fakeClaude(() => ({ status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }));
    const m2 = await ask(ana.id, t.id, { content: "Pourquoi cette note ?" }, { client: down.client });
    expect(m2.mode).toBe("llm_fallback_rules");
    expect(m2.warning).toMatch(/indisponible/);
  });

  it("n'utilise plus les données d'un groupe quitté", async () => {
    const ana = await makeUser("Ana");
    const bob = await makeUser("Bob");
    const team = await createTeam(bob.id, { name: "Duo" });
    await prisma.teamMembership.create({ data: { teamId: team.id, userId: ana.id } });
    const t = await createThread(ana.id, { teamId: team.id });
    await leaveTeam(ana.id, team.id);
    const msg = await ask(ana.id, t.id, { content: "Que doit améliorer notre groupe ?" });
    expect(msg.warning).toMatch(/plus membre/);
    const outsider = await makeUser("Out");
    await expect(createThread(outsider.id, { teamId: team.id })).rejects.toMatchObject({ status: 404 });
  });
});

describe("progression et bilans", () => {
  it("calcule forces, tendances, performances par rôle et bilan hebdomadaire, notifié une seule fois", async () => {
    const ana = await makeUser("Ana");
    for (let i = 0; i < 3; i++) await createManualMatch(ana.id, match({ visionScore: 50 }));
    const p = await progressProfile(ana.id);
    expect(p.total).toBe(3);
    expect(p.strengths.map((s) => s.key)).toContain("vision");
    expect(p.byRole[0]).toMatchObject({ key: "MIDDLE", n: 3, winrate: 100 });
    const w = await weeklyReview(ana.id);
    expect(w).toMatchObject({ matches: 3, wins: 3 });
    expect(await sendWeeklyReviews()).toBe(1);
    expect(await sendWeeklyReviews()).toBe(0); // pas de doublon
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: ana.id, type: "weekly_review" } });
    expect(n.body).toMatch(/3 partie\(s\) notée\(s\)/);
    expect(await weeklyReview((await makeUser("Vide")).id)).toBeNull();
  });
});
