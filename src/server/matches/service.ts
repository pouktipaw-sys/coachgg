// Matchs : saisie manuelle (toujours disponible) et import Riot (si configuré).
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { badRequest, notFound, HttpError } from "../errors";
import { canViewMatch } from "../permissions";
import { computeAndStoreScores, refreshTeamReportsForMatch } from "../scores";

const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
const optInt = (max: number) => z.number().int().min(0).max(max).nullish();

export const participantSchema = z.object({
  isMe: z.boolean().default(false),
  riotGameName: z.string().trim().max(32).nullish(),
  riotTagLine: z.string().trim().max(8).nullish(),
  championName: z.string().trim().min(1).max(40),
  role: z.enum(ROLES).nullish(),
  teamSide: z.union([z.literal(100), z.literal(200)]),
  win: z.boolean(),
  kills: z.number().int().min(0).max(100),
  deaths: z.number().int().min(0).max(100),
  assists: z.number().int().min(0).max(150),
  creepScore: optInt(2000),
  goldEarned: optInt(200_000),
  damageToChampions: optInt(1_000_000),
  damageToObjectives: optInt(1_000_000),
  visionScore: optInt(500),
  wardsPlaced: optInt(500),
  wardsKilled: optInt(500),
  controlWardsBought: optInt(100),
});

const sideTotals = z.object({ kills: optInt(500), damageToChampions: optInt(5_000_000), damageToObjectives: optInt(5_000_000) });

export const manualMatchSchema = z
  .object({
    gameStartAt: z.coerce.date().nullish(),
    durationSec: z.number().int().min(60).max(4 * 3600),
    gameMode: z.enum(["RANKED_SOLO", "RANKED_FLEX", "NORMAL", "ARAM", "CUSTOM", "OTHER"]),
    participants: z.array(participantSchema).min(1).max(10),
    teamTotals: z.object({ "100": sideTotals.optional(), "200": sideTotals.optional() }).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.participants.filter((p) => p.isMe).length !== 1)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["participants"], message: "Indiquez exactement un participant « moi »." });
    for (const side of [100, 200] as const) {
      const ps = m.participants.filter((p) => p.teamSide === side);
      if (ps.length > 5) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["participants"], message: `Plus de 5 joueurs côté ${side}.` });
      if (new Set(ps.map((p) => p.win)).size > 1)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["participants"], message: "Les joueurs d'une même équipe ont le même résultat." });
    }
    if (m.gameStartAt && m.gameStartAt.getTime() > Date.now() + 3600_000)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gameStartAt"], message: "Date dans le futur." });
  });

export type ManualMatchInput = z.infer<typeof manualMatchSchema>;

/** Totaux d'équipe : saisis, sinon calculés si les 5 joueurs du côté sont renseignés. */
export function deriveTeamStats(input: ManualMatchInput) {
  const out: Record<string, { kills: number | null; damageToChampions: number | null; damageToObjectives: number | null; complete: boolean }> = {};
  for (const side of ["100", "200"] as const) {
    const ps = input.participants.filter((p) => String(p.teamSide) === side);
    const given = input.teamTotals?.[side];
    const complete = ps.length === 5;
    const sum = (k: "kills" | "damageToChampions" | "damageToObjectives") => {
      if (given?.[k] != null) return given[k]!;
      if (!complete) return null;
      const vals = ps.map((p) => p[k]);
      return vals.every((v) => v != null) ? vals.reduce<number>((a, b) => a + (b as number), 0) : null;
    };
    if (ps.length === 0 && !given) continue;
    out[side] = { kills: sum("kills"), damageToChampions: sum("damageToChampions"), damageToObjectives: sum("damageToObjectives"), complete };
  }
  return out;
}

/**
 * Lie un participant à un compte CoachGG via une identité Riot déclarée, UNIQUEMENT
 * si ce compte partage un groupe avec l'auteur (évite d'associer des matchs à des inconnus).
 */
async function linkableUser(creatorId: string, gameName?: string | null, tagLine?: string | null): Promise<string | null> {
  if (!gameName || !tagLine) return null;
  const ids = await prisma.gameIdentity.findMany({
    where: {
      gameName: { equals: gameName, mode: "insensitive" },
      tagLine: { equals: tagLine, mode: "insensitive" },
      user: { memberships: { some: { team: { memberships: { some: { userId: creatorId } } } } } },
    },
    select: { userId: true },
  });
  const unique = [...new Set(ids.map((i) => i.userId))];
  return unique.length === 1 ? unique[0]! : null;
}

export async function createManualMatch(userId: string, raw: unknown) {
  const input = manualMatchSchema.parse(raw);
  const teamStats = deriveTeamStats(input);
  const linked: (string | null)[] = [];
  for (const p of input.participants) {
    const uid = p.isMe ? userId : await linkableUser(userId, p.riotGameName, p.riotTagLine);
    if (uid && linked.includes(uid)) throw badRequest("Un même compte apparaît deux fois dans la partie.");
    linked.push(uid);
  }
  const match = await prisma.match.create({
    data: {
      source: "MANUAL",
      createdById: userId,
      gameStartAt: input.gameStartAt ?? null,
      durationSec: input.durationSec,
      gameMode: input.gameMode,
      teamStats: teamStats as Prisma.InputJsonValue,
      participants: {
        create: input.participants.map((p, i) => ({
          userId: linked[i],
          riotGameName: p.riotGameName ?? null,
          riotTagLine: p.riotTagLine ?? null,
          championName: p.championName,
          role: p.role ?? null,
          teamSide: p.teamSide,
          win: p.win,
          statistics: {
            create: {
              kills: p.kills,
              deaths: p.deaths,
              assists: p.assists,
              creepScore: p.creepScore ?? null,
              goldEarned: p.goldEarned ?? null,
              damageToChampions: p.damageToChampions ?? null,
              damageToObjectives: p.damageToObjectives ?? null,
              visionScore: p.visionScore ?? null,
              wardsPlaced: p.wardsPlaced ?? null,
              wardsKilled: p.wardsKilled ?? null,
              controlWardsBought: p.controlWardsBought ?? null,
            },
          },
        })),
      },
    },
  });
  await afterMatchSaved(match.id);
  return match;
}

/** Étapes après enregistrement : notes puis rapports de groupe. Une erreur ici n'empêche pas l'accès aux stats. */
export async function afterMatchSaved(matchId: string) {
  try {
    await computeAndStoreScores(matchId);
    await refreshTeamReportsForMatch(matchId);
  } catch (e) {
    console.error("[matches] calcul des notes échoué :", e instanceof Error ? e.message : e);
  }
}

export async function deleteMatch(userId: string, matchId: string) {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m) throw notFound("Match");
  if (m.createdById !== userId) throw new HttpError(403, "forbidden", "Seul l'auteur de la saisie peut supprimer ce match.");
  await prisma.match.delete({ where: { id: matchId } });
}

export async function getMatchReport(userId: string, matchId: string) {
  if (!(await canViewMatch(userId, matchId))) throw notFound("Match");
  return prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    include: {
      participants: {
        include: { statistics: true, scores: { include: { scoreVersion: true } }, user: { select: { id: true, displayName: true } } },
        orderBy: [{ teamSide: "asc" }, { createdAt: "asc" }],
      },
      recordings: { select: { id: true, title: true, ownerId: true, status: true, _count: { select: { recommendations: true } } } },
      teamReports: { include: { team: { select: { id: true, name: true } } } },
    },
  });
}
