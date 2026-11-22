// Tâche ANALYZE_RECORDING — pipeline traçable :
// validation → association au match → synchronisation → extraction des signaux
// (sélection des séquences + contexte) → propositions (règles versionnées)
// → annotations → enregistrement en brouillon pour revue humaine.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnalysisJob, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { storage, recordingPrefix } from "../storage";
import { enqueueJob, JobCancelledError, PermanentJobError, retryJob, setJobProgress } from "../jobs";
import { notify } from "../notifications";
import { AnalyzerError, AnalyzerUnavailableError, analyzerAvailable, runAnalyzer } from "./runner";
import { buildProposals, RULES_VERSION } from "@/lib/analysis/rules";
import { autoClipsFrom } from "@/lib/analysis/autoClips";
import { AI_MOMENT_RESERVE_MICROS, AI_VERSION, AiAnalysisError, aiBudgetMicros, aiMaxMoments, aiSpentThisMonthMicros, aiDeps, aiEnabled, aiModel, gameReportAi, gameReportRules, proposalFromReview, reviewMoment, type GameReport } from "./ai";
import { requestRecap } from "../recap";
import { ensureTimelineFacts } from "../riot/import";
import { absences, deathFacts, deathTrailPlayers, myDeaths, trails } from "@/lib/riot/timelineFacts";
import { TIMELINE_VERSION, absenceProposal, timelineProposal } from "@/lib/analysis/timelineProposals";
import { alignOffset, checkOffset, findMatchForRecording, recordingTimeHints } from "@/lib/analysis/autoSync";
import { ANNOTATION_SCHEMA_VERSION } from "@/lib/annotations/schema";

type Step = { name: string; status: "ok" | "skipped" | "warning" | "failed"; ms: number; note?: string };

export const CONTEXT_CHOICES = [6, 10, 15] as const;

export type AutoClipChoice = { deaths: boolean; fights: boolean };

/**
 * Met en file (ou relance) l'analyse d'une vidéo prête. Idempotent : une tâche par vidéo.
 * `autoClips` absent → préférences du profil du propriétaire au moment de l'analyse.
 */
export async function requestAnalysis(recordingId: string, contextSec = 10, autoClips?: AutoClipChoice) {
  const key = `analyze:${recordingId}`;
  const payload = autoClips ? { contextSec, autoClips } : { contextSec };
  const job = await enqueueJob({ type: "ANALYZE_RECORDING", idempotencyKey: key, recordingId, payload, maxAttempts: 2 });
  if (job.status === "RUNNING") return job;
  if (job.status !== "PENDING" || JSON.stringify(job.payload) !== JSON.stringify(payload)) {
    await prisma.analysisJob.update({ where: { id: job.id }, data: { payload, version: RULES_VERSION } });
    return retryJob(job.id);
  }
  return job;
}

/** Après traitement vidéo : lance l'analyse automatiquement si le worker en est capable. */
export async function autoRequestAnalysis(recordingId: string) {
  if ((await analyzerAvailable()).ok) await requestAnalysis(recordingId);
}

export async function analyzeRecording(job: AnalysisJob) {
  const steps: Step[] = [];
  const step = async <T,>(name: string, fn: () => Promise<{ value: T; status?: Step["status"]; note?: string }>) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      steps.push({ name, status: r.status ?? "ok", ms: Date.now() - t0, note: r.note });
      return r.value;
    } catch (e) {
      steps.push({ name, status: "failed", ms: Date.now() - t0, note: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };
  const contextSec = Number((job.payload as { contextSec?: number } | null)?.contextSec ?? 10);

  // 1. Validation
  const rec = await step("Validation de la vidéo", async () => {
    if (!job.recordingId) throw new PermanentJobError("Tâche sans vidéo.");
    const r = await prisma.recording.findUnique({ where: { id: job.recordingId } });
    if (!r) throw new JobCancelledError("Vidéo supprimée.");
    if (r.status !== "READY" || !r.playbackKey || !r.durationMs || !r.width || !r.height)
      throw new PermanentJobError("La vidéo doit être prête (traitée) avant l'analyse.");
    return { value: r };
  });

  // 2. Association au match
  await step("Association au match", async () =>
    rec.matchId ? { value: null, note: "Vidéo liée à un match." } : { value: null, status: "skipped", note: "Aucun match lié : statistiques non croisées." },
  );

  // 3. Synchronisation des horodatages
  await step("Synchronisation des horodatages", async () =>
    rec.gameStartOffsetMs != null
      ? { value: null, note: "Temps de jeu affiché dans les observations." }
      : { value: null, status: "skipped", note: "Pas de synchronisation avec l'horloge du jeu : temps vidéo uniquement." },
  );

  const minimap = (rec.minimapRegion as { x: number; y: number; w: number; h: number } | null) ?? null;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "coachgg-an-"));
  const abort = new AbortController();
  try {
    // 4-5. Sélection des séquences + extraction d'images et de signaux (contexte avant l'action)
    let last = 0;
    let cancelled = false;
    const out = await step("Extraction des signaux et sélection des séquences", async () => {
      try {
        const o = await runAnalyzer({
          video: storage().localPath(rec.playbackKey!),
          outDir: tmp,
          width: rec.width!,
          height: rec.height!,
          durationMs: rec.durationMs!,
          contextSec,
          minimap,
          signal: abort.signal,
          onProgress: (p) => {
            if (p - last < 5) return;
            last = p;
            setJobProgress(job.id, p * 0.9).catch(() => {
              cancelled = true;
              abort.abort();
            });
          },
        });
        return {
          value: o,
          status: o.warnings.length ? "warning" : "ok",
          note: `${o.sampling.frames} images échantillonnées à ${o.sampling.fps} i/s ; ${o.events.length} séquence(s) retenue(s).${o.warnings.length ? " " + o.warnings.join(" ") : ""}`,
        };
      } catch (e) {
        if (cancelled) throw new JobCancelledError("Analyse annulée.");
        if (e instanceof AnalyzerUnavailableError) throw new PermanentJobError(e.message);
        if (e instanceof AnalyzerError) throw e; // nouvelle tentative possible
        throw e;
      }
    });

    // 6-8. Analyse du contexte, propositions de diagnostic, alternatives (règles versionnées)
    const proposals = await step("Propositions (règles " + RULES_VERSION + ")", async () => {
      const p = buildProposals(out, { durationMs: rec.durationMs!, gameStartOffsetMs: rec.gameStartOffsetMs });
      return { value: p, note: `${p.length} proposition(s).` };
    });

    // 8 0. Liaison à la partie Riot (date du fichier) et synchronisation (alignement des morts), si absentes.
    await step("Liaison et synchronisation automatiques", async () => {
      const notes: string[] = [];
      if (!rec.matchId) {
        const hints = recordingTimeHints(rec);
        if (!hints.length) return { value: null, status: "skipped", note: "Aucune date d'enregistrement connue : lie la vidéo à sa partie (encadré « Informations »)." };
        const candidates = await prisma.match.findMany({
          where: { source: "RIOT_API", gameStartAt: { not: null }, participants: { some: { userId: rec.ownerId } } },
          select: { id: true, gameStartAt: true, durationSec: true },
          orderBy: { gameStartAt: "desc" },
          take: 300,
        });
        const found = findMatchForRecording(
          candidates.map((c) => ({ id: c.id, startAt: c.gameStartAt!, durationSec: c.durationSec })),
          hints,
          rec.durationMs,
        );
        if (!found) {
          const when = hints.map((h) => `${h.at.toLocaleString("fr-FR")} (${h.source})`).join(", ");
          const why = candidates.length ? `aucune de tes ${candidates.length} partie(s) importée(s) ne correspond à : ${when}` : "aucune partie Riot importée (connecte ton compte Riot et synchronise tes parties)";
          return { value: null, status: "skipped", note: `Liaison impossible : ${why}. Lie la vidéo à la main.` };
        }
        const m = found.match;
        await prisma.recording.update({ where: { id: rec.id }, data: { matchId: m.id } });
        Object.assign(rec, { matchId: m.id });
        notes.push(`Vidéo liée à la partie du ${m.startAt.toLocaleString("fr-FR")} (${found.source}) — vérifie que c'est la bonne.`);
      }
      let status: "ok" | "warning" | "skipped" = "ok";
      if (rec.matchId) {
        const me = await prisma.matchParticipant.findFirst({ where: { matchId: rec.matchId, userId: rec.ownerId }, select: { puuid: true } });
        const ct = me?.puuid ? await ensureTimelineFacts(rec.matchId) : null;
        const gameDeaths = ct && me?.puuid ? myDeaths(ct, me.puuid).map((d) => d.t) : [];
        const videoDeaths = out.events.filter((e) => e.type === "grey_screen").map((e) => e.startMs);
        const aligned = alignOffset(videoDeaths, gameDeaths);
        const s1 = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",");
        if (rec.gameStartOffsetMs == null) {
          if (aligned) {
            await prisma.recording.update({ where: { id: rec.id }, data: { gameStartOffsetMs: aligned.offsetMs } });
            Object.assign(rec, { gameStartOffsetMs: aligned.offsetMs });
            notes.push(`Synchronisée automatiquement : ${aligned.matches} mort(s) alignée(s) avec la timeline, écart moyen ${s1(aligned.residualMs)} s (00:00 en jeu à ${s1(aligned.offsetMs)} s de la vidéo).`);
          } else {
            status = "warning";
            notes.push(`Synchronisation automatique impossible ou ambiguë (${videoDeaths.length} mort(s) vue(s) à l'image, ${gameDeaths.length} dans la timeline ; il en faut 2 concordantes sans ambiguïté) : utilise l'onglet « Synchro ».`);
          }
        } else if (videoDeaths.length && gameDeaths.length) {
          // Synchro déjà réglée (à la main ou par l'application PC) : vérifiée contre les vraies morts.
          const check = checkOffset(videoDeaths, gameDeaths, rec.gameStartOffsetMs);
          // Vérifiée seulement si aucun autre réglage n'aligne davantage de morts (évite un décalage d'une mort).
          const better = aligned && aligned.matches > check.matches && Math.abs(aligned.offsetMs - rec.gameStartOffsetMs) > 3000;
          if (!better && check.matches > 0 && check.matches >= Math.min(2, videoDeaths.length, gameDeaths.length)) {
            notes.push(`Synchro vérifiée : ${check.matches} mort(s) concordent avec la timeline (écart moyen ${s1(check.residualMs ?? 0)} s).`);
          } else if (aligned && aligned.matches >= 3 && Math.abs(aligned.offsetMs - rec.gameStartOffsetMs) > 3000) {
            const delta = aligned.offsetMs - rec.gameStartOffsetMs;
            await prisma.recording.update({ where: { id: rec.id }, data: { gameStartOffsetMs: aligned.offsetMs } });
            Object.assign(rec, { gameStartOffsetMs: aligned.offsetMs });
            status = "warning";
            notes.push(`Synchro réglée décalée de ${s1(Math.abs(delta))} s : corrigée automatiquement (${aligned.matches} morts concordent, écart moyen ${s1(aligned.residualMs)} s).`);
          } else if (aligned && Math.abs(aligned.offsetMs - rec.gameStartOffsetMs) > 3000) {
            status = "warning";
            notes.push(`Attention : la synchro semble décalée d'environ ${s1(Math.abs(aligned.offsetMs - rec.gameStartOffsetMs))} s (${aligned.matches} morts concordent avec un autre réglage). Vérifie l'onglet « Synchro ».`);
          } else notes.push("Synchro réglée non vérifiable (morts vues à l'image et timeline ne concordent pas assez).");
        }
      }
      return notes.length ? { value: null, status, note: notes.join(" ") } : { value: null, status: "skipped", note: "Déjà liée et synchronisée." };
    });

    // 8 a. Timeline Riot : morts réelles du joueur, faits mesurés et schéma minimap (vidéo liée et synchronisée).
    const extraDeaths: { type: "grey_screen"; startMs: number; endMs: number }[] = [];
    const falseGrey: number[] = []; // écrans grisés démentis par la timeline (temps vidéo)
    const absenceClips: { kind: "MISSED_OPPORTUNITY"; title: string; startMs: number; endMs: number; eventMs: number }[] = [];
    await step("Timeline Riot (morts et positions réelles)", async () => {
      if (!rec.matchId) return { value: 0, status: "skipped", note: "Vidéo non liée à un match." };
      if (rec.gameStartOffsetMs == null) return { value: 0, status: "skipped", note: "Vidéo non synchronisée avec l'horloge du jeu (onglet « Synchro »)." };
      const me = await prisma.matchParticipant.findFirst({ where: { matchId: rec.matchId, userId: rec.ownerId }, select: { puuid: true } });
      if (!me?.puuid) return { value: 0, status: "skipped", note: "Match saisi à la main ou joueur non identifié : pas de timeline." };
      const ct = await ensureTimelineFacts(rec.matchId);
      if (!ct) return { value: 0, status: "skipped", note: "Timeline indisponible (clé Riot absente ou expirée)." };
      let added = 0;
      let merged = 0;
      for (const d of myDeaths(ct, me.puuid)) {
        const deathVideoMs = d.t + rec.gameStartOffsetMs!;
        const facts = deathFacts(ct, me.puuid, d);
        // Reconstitution : trajets estimés des 15 s avant la mort (toi, ennemis impliqués, alliés à portée).
        const trailList = minimap ? trails(ct, deathTrailPlayers(ct, me.puuid, d, facts), d.t - Math.min(15_000, contextSec * 1000), d.t, rec.gameStartOffsetMs!) : [];
        const p = timelineProposal(facts, { deathVideoMs, durationMs: rec.durationMs!, contextSec, minimap: !!minimap, trails: trailList });
        if (!p) continue;
        // La mort détectée à l'image (écran grisé) correspondante est remplacée par la version mesurée.
        const twin = proposals.findIndex((x) => (x.evidence as { type?: string }).type === "grey_screen" && Math.abs(x.recommendation.decisionMs + 2000 - deathVideoMs) <= 5000);
        if (twin >= 0) {
          p.sheet = proposals[twin]!.sheet;
          proposals.splice(twin, 1);
          merged++;
        } else extraDeaths.push({ type: "grey_screen", startMs: deathVideoMs, endMs: deathVideoMs + 5000 });
        proposals.push(p);
        added++;
      }
      // Écrans grisés sans mort réelle correspondante : fausses détections (chargement, effet visuel…), écartées.
      for (let i = proposals.length - 1; i >= 0; i--) {
        const x = proposals[i]!;
        if ((x.evidence as { type?: string }).type !== "grey_screen") continue;
        falseGrey.push(x.recommendation.decisionMs + 2000);
        proposals.splice(i, 1);
      }
      // Mauvais moments sans mort : combat perdu ou objectif pris pendant que le joueur était loin.
      let missed = 0;
      for (const a of absences(ct, me.puuid)) {
        const mePid = ct.participants.find((x) => x.puuid === me.puuid)!.pid;
        const trailList = minimap ? trails(ct, [{ pid: mePid, style: "actual", label: "Toi (trajet estimé)" }], a.t - 12_000, a.t, rec.gameStartOffsetMs!) : [];
        const p = absenceProposal(a, { videoMs: a.t + rec.gameStartOffsetMs!, durationMs: rec.durationMs!, minimap: !!minimap, trails: trailList });
        if (!p) continue;
        proposals.push(p);
        absenceClips.push({ kind: "MISSED_OPPORTUNITY", title: p.recommendation.title, startMs: p.recommendation.contextStartMs, endMs: p.recommendation.endMs, eventMs: p.recommendation.decisionMs });
        missed++;
      }
      proposals.sort((a, b) => a.recommendation.decisionMs - b.recommendation.decisionMs);
      return {
        value: added + missed,
        note: `${added} mort(s) réelle(s) analysée(s) avec les faits de la partie (${merged} confirmée(s) par l'image${falseGrey.length ? `, ${falseGrey.length} fausse(s) détection(s) d'écran grisé écartée(s)` : ""}) ; ${missed} moment(s) sans mort (combat perdu ou objectif raté loin de toi)${minimap ? "" : " ; zone minimap non définie : pas de schéma des positions"}.`,
      };
    });

    // 8 b. Analyse par IA (Claude) des morts probables : observations, alternative, conseil et schéma.
    // Coût cumulé : une relance réutilise la même tâche, la dépense précédente est conservée.
    const baseCost = job.costMicros ?? 0;
    let costMicros = 0;
    if (aiEnabled()) {
      await step("Analyse IA des moments (Claude)", async () => {
        const deaths = proposals
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => ["grey_screen", "riot_death"].includes((p.evidence as { type?: string }).type ?? ""))
          .slice(0, aiMaxMoments());
        let ok = 0;
        const errors: string[] = [];
        const budget = aiBudgetMicros();
        const spentBefore = budget ? await aiSpentThisMonthMicros() : 0;
        for (const { p, i } of deaths) {
          // Plafond : on n'entame jamais un moment qui pourrait faire dépasser le budget du mois.
          if (budget && spentBefore + costMicros + AI_MOMENT_RESERVE_MICROS > budget) {
            errors.push(`budget IA du mois atteint (${(budget / 1e6).toFixed(2)} $) : analyse par règles pour la suite`);
            break;
          }
          try {
            const r = await reviewMoment(
              {
                video: storage().localPath(rec.playbackKey!),
                tmp,
                index: i,
                contextStartMs: p.recommendation.contextStartMs,
                // Mort réelle (timeline) si connue ; sinon la règle place la décision 2 s avant l'écran grisé.
                deathMs: (p.evidence as { deathVideoMs?: number }).deathVideoMs ?? p.recommendation.decisionMs + 2000,
                gameStartOffsetMs: rec.gameStartOffsetMs,
                ruleObservations: p.recommendation.observations,
                minimap,
              },
              aiDeps.client(),
            );
            costMicros += r.costMicros;
            const replaced = proposalFromReview(p, r.review, r.times, r.model, rec.durationMs!, { hasMinimap: !!minimap });
            if (replaced) {
              if ((p.evidence as { type?: string }).type === "riot_death") {
                // Les faits mesurés restent en tête ; le schéma minimap (positions réelles) est conservé.
                replaced.recommendation.observations = [...p.recommendation.observations.slice(0, 4), ...replaced.recommendation.observations].slice(0, 9);
                replaced.annotations = [...p.annotations, ...replaced.annotations];
                // Cause mesurée prioritaire : l'IA ne peut pas la contredire, elle l'explique avec les images.
                if (p.recommendation.kind === "MISTAKE") {
                  replaced.recommendation.title = p.recommendation.title;
                  replaced.recommendation.kind = p.recommendation.kind;
                  replaced.recommendation.category = p.recommendation.category;
                  replaced.recommendation.interpretation = `${p.recommendation.interpretation} Lecture des images : ${replaced.recommendation.interpretation}`.slice(0, 2500);
                  replaced.recommendation.confidence = "MEDIUM"; // cause mesurée par la timeline
                }
              }
              proposals[i] = replaced;
              ok++;
            } else errors.push(`image illisible à ${p.recommendation.decisionMs} ms`);
          } catch (e) {
            costMicros += (e as { costMicros?: number }).costMicros ?? 0;
            errors.push(e instanceof AiAnalysisError ? e.message : "erreur inattendue");
            if (e instanceof AiAnalysisError && e.kind === "auth") break;
          }
          await prisma.analysisJob.update({ where: { id: job.id }, data: { costMicros: baseCost + costMicros } }).catch(() => {});
        }
        const note = `${ok}/${deaths.length} moment(s) analysé(s) par ${aiModel()} · coût estimé ${(costMicros / 1e6).toFixed(3)} $${errors.length ? ` · non analysés : ${[...new Set(errors)].join(" ; ")}` : ""}`;
        if (!deaths.length) return { value: 0, status: "skipped", note: "Aucune mort détectée à analyser : l'IA n'a pas été appelée (aucun coût)." };
        return { value: ok, status: errors.length && !ok ? "warning" : "ok", note };
      });
    }

    // 9-10. Annotations + rapport : remplace les brouillons automatiques précédents (idempotent)
    const created = await step("Annotations et enregistrement pour revue", async () => {
      const still = await prisma.recording.findUnique({ where: { id: rec.id }, select: { id: true } });
      if (!still) throw new JobCancelledError("Vidéo supprimée pendant l'analyse.");
      const old = await prisma.recommendation.findMany({ where: { recordingId: rec.id, provenance: "AUTOMATIC", status: "DRAFT" }, select: { id: true, contextSheetKey: true } });
      for (const o of old) if (o.contextSheetKey) await storage().delete(o.contextSheetKey);
      await prisma.videoAnnotation.deleteMany({ where: { recordingId: rec.id, provenance: "AUTOMATIC", recommendation: { status: "DRAFT" } } });
      await prisma.recommendation.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

      // Une proposition déjà validée ou rejetée au même instant n'est pas recréée.
      const reviewed = await prisma.recommendation.findMany({
        where: { recordingId: rec.id, provenance: "AUTOMATIC", status: { not: "DRAFT" } },
        select: { decisionMs: true, kind: true },
      });
      let n = 0;
      for (const p of proposals) {
        if (reviewed.some((r) => r.kind === p.recommendation.kind && Math.abs(r.decisionMs - p.recommendation.decisionMs) < 3000)) continue;
        const r = p.recommendation;
        let sheetKey: string | null = null;
        if (p.sheet) {
          sheetKey = `${recordingPrefix(rec.ownerId, rec.id)}analysis/${job.id}-${n}.jpg`;
          await storage().importFile(sheetKey, path.join(tmp, p.sheet));
        }
        await prisma.recommendation.create({
          data: {
            recordingId: rec.id,
            kind: r.kind,
            category: r.category,
            title: r.title,
            contextStartMs: r.contextStartMs,
            slowdownStartMs: r.slowdownStartMs,
            decisionMs: r.decisionMs,
            endMs: r.endMs,
            slowdownRate: r.slowdownRate,
            interpretation: r.interpretation,
            alternatives: r.alternatives,
            confidence: r.confidence,
            confidenceReason: r.confidenceReason,
            advice: r.advice,
            provenance: "AUTOMATIC",
            analysisVersion: (p.evidence as { ai?: { model: string } }).ai
              ? `${AI_VERSION} (${(p.evidence as { ai: { model: string } }).ai.model})`
              : ["riot_death", "riot_absence"].includes((p.evidence as { type?: string }).type ?? "")
                ? TIMELINE_VERSION
                : RULES_VERSION,
            status: "DRAFT",
            analysisJobId: job.id,
            autoEvidence: p.evidence as Prisma.InputJsonValue,
            contextSheetKey: sheetKey,
            observations: {
              create: r.observations.map((text) => ({
                text,
                recordingId: rec.id,
                timeMs: r.decisionMs,
                category: r.category,
                source: "video",
                provenance: "AUTOMATIC",
                analysisJobId: job.id,
                analysisVersion: RULES_VERSION,
              })),
            },
            annotations: {
              create: p.annotations.map((a) => ({
                recordingId: rec.id,
                type: a.type,
                startMs: a.startMs,
                endMs: a.endMs,
                space: a.space,
                geometry: a.geometry as Prisma.InputJsonValue,
                style: a.style,
                label: a.label ?? null,
                provenance: "AUTOMATIC",
                schemaVersion: ANNOTATION_SCHEMA_VERSION,
              })),
            },
          },
        });
        n++;
      }
      return { value: n, note: `${n} proposition(s) enregistrée(s) en brouillon.` };
    });

    // 11. Découpage automatique en clips (morts, et combats si demandé) — remplace les clips
    //     automatiques non retouchés de l'analyse précédente ; ceux que l'utilisateur a modifiés restent.
    const clipsCreated = await step<number>("Découpage automatique en clips", async () => {
      let choice: AutoClipChoice | undefined = (job.payload as { autoClips?: AutoClipChoice } | null)?.autoClips;
      if (!choice) {
        const prof = await prisma.playerProfile.findUnique({ where: { userId: rec.ownerId }, select: { autoClipDeaths: true, autoClipFights: true } });
        choice = { deaths: prof?.autoClipDeaths ?? true, fights: prof?.autoClipFights ?? false };
      }
      if (!choice.deaths && !choice.fights) return { value: 0, status: "skipped", note: "Désactivé dans les réglages." };
      await prisma.clip.deleteMany({ where: { recordingId: rec.id, provenance: "AUTOMATIC", favorite: false, personalNote: null, exportStatus: null } });
      const kept = await prisma.clip.findMany({ where: { recordingId: rec.id }, select: { kind: true, startMs: true, endMs: true } });
      // Les moments « absent » (rotations ratées, mesurées par la timeline) sont découpés avec les morts.
      const wanted: { kind: "DEATH" | "FIGHT" | "MISSED_OPPORTUNITY"; title: string; startMs: number; endMs: number; eventMs: number }[] = [
        ...autoClipsFrom(
          [...out.events.filter((e) => !(e.type === "grey_screen" && falseGrey.some((f) => Math.abs(f - e.startMs) <= 2500))), ...extraDeaths],
          rec.durationMs!,
          rec.gameStartOffsetMs,
          { ...choice, contextSec },
        ),
        ...(choice.deaths ? absenceClips : []),
      ];
      // Un clip conservé (favori, annoté, exporté, ou manuel) qui contient déjà l'événement suffit.
      const fresh = wanted.filter((c) => !kept.some((k) => k.kind === c.kind && k.startMs <= c.eventMs && k.endMs >= c.eventMs));
      if (fresh.length)
        await prisma.clip.createMany({
          data: fresh.map((c) => ({ recordingId: rec.id, ownerId: rec.ownerId, title: c.title, kind: c.kind, startMs: c.startMs, endMs: c.endMs, provenance: "AUTOMATIC" as const })),
        });
      const deaths = fresh.filter((c) => c.kind === "DEATH").length;
      const missedN = fresh.filter((c) => c.kind === "MISSED_OPPORTUNITY").length;
      return { value: fresh.length, note: `${fresh.length} clip(s) créé(s) : ${deaths} mort(s), ${missedN} rotation(s) ratée(s), ${fresh.length - deaths - missedN} combat(s).` };
    });

    // 12. Bilan écrit de la partie (IA si disponible, sinon construit à partir des moments).
    const report = await step<GameReport>("Bilan de la partie", async () => {
      const moments = await prisma.recommendation.findMany({
        where: { recordingId: rec.id, status: { not: "REJECTED" } },
        orderBy: { decisionMs: "asc" },
        select: { title: true, kind: true, category: true, advice: true, decisionMs: true, provenance: true, status: true, autoEvidence: true, observations: { select: { text: true }, take: 4, orderBy: { createdAt: "asc" } } },
      });
      const lite = moments.map((m) => ({
        title: m.title,
        kind: m.kind,
        category: m.category,
        advice: m.advice,
        decisionMs: m.decisionMs,
        automatic: m.provenance === "AUTOMATIC" && m.status === "DRAFT",
        flags: (m.autoEvidence as { flags?: string[] } | null)?.flags ?? [],
        facts: m.observations.map((o) => o.text),
      }));
      const deaths = moments.filter((m) => /mort|écran grisé/i.test(m.title)).length;
      let body = gameReportRules(lite, { linked: !!rec.matchId, minimap: !!minimap, videoMs: rec.durationMs });
      let source: GameReport["source"] = "rules";
      let model: string | undefined;
      const budget = aiBudgetMicros();
      const withinBudget = !budget || (await aiSpentThisMonthMicros()) + AI_MOMENT_RESERVE_MICROS <= budget;
      if (aiEnabled() && lite.length && withinBudget) {
        try {
          const stats = rec.matchId
            ? await prisma.matchParticipant
                .findFirst({ where: { matchId: rec.matchId, userId: rec.ownerId }, include: { statistics: true } })
                .then((p) => (p?.statistics ? `${p.championName}, ${p.win ? "victoire" : "défaite"}, ${p.statistics.kills}/${p.statistics.deaths}/${p.statistics.assists}, ${p.statistics.creepScore ?? "?"} CS, vision ${p.statistics.visionScore ?? "?"}` : null))
            : null;
          const r = await gameReportAi(lite, stats, aiDeps.client());
          costMicros += r.costMicros;
          body = r.report;
          source = "ai";
          model = r.model;
        } catch (e) {
          costMicros += (e as { costMicros?: number }).costMicros ?? 0;
        }
      }
      const full: GameReport = { ...body, source, model, moments: lite.length, deaths, generatedAt: new Date().toISOString() };
      await prisma.recording.update({ where: { id: rec.id }, data: { gameReport: full as unknown as Prisma.InputJsonValue } });
      if (costMicros) await prisma.analysisJob.update({ where: { id: job.id }, data: { costMicros: baseCost + costMicros } });
      return { value: full, note: source === "ai" ? `Rédigé par ${model}.` : "Construit à partir des moments détectés (sans IA)." };
    });

    // 13. Vidéo récap : intro, chaque moment annoté (ralenti, pause, schéma, conseil), bilan.
    await step("Vidéo récap", async () => {
      if (!report.moments) return { value: null, status: "skipped", note: "Aucun moment à monter." };
      await requestRecap(rec.id);
      return { value: null, note: "Montage lancé en tâche de fond." };
    });

    const partial = steps.some((s) => s.status === "warning");
    const status: "NEEDS_REVIEW" | "PARTIAL" | "SUCCEEDED" = created > 0 ? "NEEDS_REVIEW" : partial ? "PARTIAL" : "SUCCEEDED";
    await notify(rec.ownerId, {
      type: "analysis_done",
      title: "Analyse assistée terminée",
      body:
        (created > 0 ? `« ${rec.title} » : ${created} proposition(s) à valider.` : `« ${rec.title} » : aucune proposition.`) +
        (clipsCreated > 0 ? ` ${clipsCreated} clip(s) ajouté(s) à votre bibliothèque.` : ""),
      link: `/app/videos/${rec.id}`,
    });
    // Détections brutes conservées (sans les planches) : base de l'évaluation de précision.
    const detections = out.events.map((e) => ({ type: e.type, startMs: e.startMs, endMs: e.endMs, confidence: e.confidence }));
    return {
      status,
      result: { version: RULES_VERSION, contextSec, steps, created, clipsCreated, warnings: out.warnings, baselines: out.baselines, sampling: out.sampling, detections },
    };
  } catch (e) {
    // Trace des étapes conservée même en cas d'échec.
    await prisma.analysisJob.update({ where: { id: job.id }, data: { result: { version: RULES_VERSION, contextSec, steps } } }).catch(() => {});
    throw e;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
