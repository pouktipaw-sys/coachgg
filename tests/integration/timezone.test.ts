// Serveur PostgreSQL réglé sur une heure locale (cas courant sous Windows) :
// les horodatages de la file de tâches doivent rester cohérents (UTC).
// Pour reproduire : ALTER DATABASE coachgg_test SET timezone TO 'Pacific/Kiritimati' avant la suite.
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { claimNextJob, completeJob, enqueueJob } from "@/server/jobs";

describe("fuseau horaire PostgreSQL", () => {
  it("durée de traitement positive et tâche disponible immédiatement", async () => {
    const job = await enqueueJob({ type: "COMPUTE_SCORES", idempotencyKey: `tz:${Date.now()}` });
    const claimed = await claimNextJob("tz-test");
    expect(claimed?.id).toBe(job.id);
    expect(Math.abs(claimed!.startedAt!.getTime() - Date.now())).toBeLessThan(60_000);
    await completeJob(claimed!, {});
    const done = await prisma.analysisJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.processingMs).toBeGreaterThanOrEqual(0);
    expect(done.processingMs).toBeLessThan(60_000);
  });
});
