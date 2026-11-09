import { describe, expect, it } from "vitest";
import { gameRange, needsResync, videoPositionFor } from "@/lib/video/sync";

describe("horloge de jeu commune", () => {
  const a = { id: "a", gameStartOffsetMs: 30_000, durationMs: 600_000 }; // 00:00 en jeu à 0:30 de la vidéo
  const b = { id: "b", gameStartOffsetMs: -120_000, durationMs: 300_000 }; // vidéo commencée à 2:00 de jeu

  it("convertit le temps de jeu en position vidéo pour chaque piste", () => {
    expect(videoPositionFor(150_000, a)).toEqual({ videoMs: 180_000, inRange: true });
    expect(videoPositionFor(150_000, b)).toEqual({ videoMs: 30_000, inRange: true });
  });

  it("signale les instants hors de la vidéo", () => {
    expect(videoPositionFor(60_000, b)).toEqual({ videoMs: 0, inRange: false });
    expect(videoPositionFor(500_000, b)).toEqual({ videoMs: 300_000, inRange: false });
    expect(videoPositionFor(-40_000, a).inRange).toBe(false);
  });

  it("calcule l'intervalle couvert et la dérive tolérée", () => {
    expect(gameRange([a, b])).toEqual({ startMs: -30_000, endMs: 570_000 });
    expect(gameRange([])).toBeNull();
    expect(needsResync(10_000, 10_200)).toBe(false);
    expect(needsResync(10_000, 10_400)).toBe(true);
  });
});
