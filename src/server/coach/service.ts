// Coach conversationnel : fils de discussion, réponses sourcées, repli sans IA.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, notFound } from "../errors";
import { teamMembership } from "../permissions";
import { rateLimit } from "../rateLimit";
import { allSources, buildCoachContext } from "./context";
import { answerWithRules, type CoachAnswer } from "./rules";
import { answerWithLlm, CoachLlmError, llmConfigured, validateCitations, type HistoryTurn, type LlmUsage } from "./llm";
import type Anthropic from "@anthropic-ai/sdk";

export const askSchema = z.object({ content: z.string().trim().min(2).max(1000) });

export async function createThread(userId: string, raw: unknown) {
  const { teamId } = z.object({ teamId: z.string().nullish() }).parse(raw ?? {});
  if (teamId && !(await teamMembership(userId, teamId))) throw notFound("Groupe");
  return prisma.coachThread.create({ data: { userId, title: "Nouvelle conversation", teamId: teamId ?? null } });
}

export async function listThreads(userId: string) {
  return prisma.coachThread.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, updatedAt: true, teamId: true } });
}

async function ownedThread(userId: string, threadId: string) {
  const t = await prisma.coachThread.findUnique({ where: { id: threadId } });
  if (!t || t.userId !== userId) throw notFound("Conversation");
  return t;
}

export async function getThread(userId: string, threadId: string) {
  const t = await ownedThread(userId, threadId);
  const messages = await prisma.coachMessage.findMany({ where: { threadId }, orderBy: { createdAt: "asc" } });
  return { thread: t, messages };
}

export async function deleteThread(userId: string, threadId: string) {
  await ownedThread(userId, threadId);
  await prisma.coachThread.delete({ where: { id: threadId } });
}

export async function ask(userId: string, threadId: string, raw: unknown, opts: { client?: Anthropic } = {}) {
  const { content } = askSchema.parse(raw);
  const thread = await ownedThread(userId, threadId);
  if (!rateLimit(`coach:${userId}`, 40, 3600_000)) throw new HttpError(429, "rate_limited", "Trop de questions récentes, réessayez plus tard.");

  // Le contexte de groupe n'est utilisé que si l'utilisateur en est TOUJOURS membre.
  const teamId = thread.teamId && (await teamMembership(userId, thread.teamId)) ? thread.teamId : null;
  const previous = await prisma.coachMessage.findMany({ where: { threadId }, orderBy: { createdAt: "asc" }, take: 40 });
  await prisma.coachMessage.create({ data: { threadId, role: "user", content } });

  const t0 = Date.now();
  const ctx = await buildCoachContext(userId, { teamId });
  const sources = allSources(ctx);
  let answer: CoachAnswer;
  let mode: "llm" | "rules" | "llm_fallback_rules" = "rules";
  let usage: LlmUsage | null = null;
  const warnings: string[] = [];
  if (thread.teamId && !teamId) warnings.push("Vous n'êtes plus membre du groupe lié à cette conversation : ses données ne sont plus utilisées.");

  if (llmConfigured() || opts.client) {
    try {
      const history: HistoryTurn[] = previous.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const r = await answerWithLlm(content, sources, history, opts.client);
      answer = r.answer;
      usage = r.usage;
      mode = "llm";
    } catch (e) {
      const err = e instanceof CoachLlmError ? e : new CoachLlmError("unavailable", "Erreur de l'IA.");
      usage = (e as { usage?: LlmUsage }).usage ?? null;
      console.error("[coach] repli sur le mode règles :", err.kind);
      answer = answerWithRules(content, ctx);
      mode = "llm_fallback_rules";
      warnings.push(`${err.message} Réponse produite par le mode sans IA.`);
    }
  } else {
    answer = answerWithRules(content, ctx);
  }

  const { valid, invalid } = validateCitations(answer.citations, sources);
  if (invalid.length) warnings.push(`${invalid.length} référence(s) inexistante(s) retirée(s) de la réponse.`);
  if (valid.length === 0 && answer.missingInformation.length === 0 && mode === "llm")
    warnings.push("Réponse sans source vérifiable : à prendre avec prudence.");

  const msg = await prisma.coachMessage.create({
    data: {
      threadId,
      role: "assistant",
      content: answer.answer,
      citations: valid as unknown as Prisma.InputJsonValue,
      missingInformation: answer.missingInformation,
      followUps: answer.followUps.slice(0, 4),
      mode,
      model: usage?.model ?? null,
      sourcesCount: sources.length,
      inputTokens: usage ? usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens : null,
      outputTokens: usage?.outputTokens ?? null,
      cacheReadTokens: usage?.cacheReadTokens ?? null,
      costMicros: usage?.costMicros ?? null,
      latencyMs: Date.now() - t0,
      warning: warnings.join(" ") || null,
    },
  });
  await prisma.coachThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date(), ...(previous.length === 0 ? { title: content.slice(0, 80) } : {}) },
  });
  return msg;
}

export async function reportMessage(userId: string, messageId: string, comment?: string) {
  const m = await prisma.coachMessage.findUnique({ where: { id: messageId }, include: { thread: true } });
  if (!m || m.thread.userId !== userId || m.role !== "assistant") throw notFound("Message");
  return prisma.coachMessage.update({ where: { id: messageId }, data: { reportedAt: new Date(), reportComment: comment?.slice(0, 1000) ?? null } });
}

/** Statistiques d'usage et de coût (administration). */
export async function coachUsage() {
  const rows = await prisma.coachMessage.groupBy({
    by: ["mode"],
    where: { role: "assistant" },
    _count: { _all: true },
    _sum: { costMicros: true, inputTokens: true, outputTokens: true, cacheReadTokens: true },
    _avg: { latencyMs: true },
  });
  const reported = await prisma.coachMessage.findMany({ where: { reportedAt: { not: null } }, orderBy: { reportedAt: "desc" }, take: 20, select: { id: true, content: true, reportComment: true, mode: true, model: true, reportedAt: true } });
  return { rows, reported };
}
