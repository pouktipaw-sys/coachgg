import { describe, expect, it } from "vitest";
import { alignOffset, parseRecordingDate, pickMatch } from "@/lib/analysis/autoSync";

describe("liaison et synchronisation automatiques", () => {
  it("lit la date dans les noms de fichiers courants", () => {
    expect(parseRecordingDate("League of Legends (TM) Client 2024-09-18 19-24-33")?.toISOString()).toBe(new Date(2024, 8, 18, 19, 24, 33).toISOString());
    expect(parseRecordingDate("2025.01.05-21.03.10.mp4")?.getHours()).toBe(21);
    expect(parseRecordingDate("Replay_20240918_192433.mp4")?.getMinutes()).toBe(24);
    expect(parseRecordingDate("partie.mp4")).toBeNull();
  });

  it("choisit la partie qui contient l'heure d'enregistrement", () => {
    const at = (h: number, m: number) => new Date(2024, 8, 18, h, m);
    const matches = [
      { id: "a", startAt: at(18, 0), durationSec: 1800 },
      { id: "b", startAt: at(19, 20), durationSec: 1900 },
      { id: "c", startAt: at(22, 0), durationSec: 1500 },
    ];
    expect(pickMatch(matches, at(19, 24))?.id).toBe("b");
    expect(pickMatch(matches, at(21, 30))).toBeNull();
  });

  it("aligne les morts vues à l'image sur la timeline (au moins 2 concordances)", () => {
    // Vidéo commencée 95 s avant 00:00 en jeu ; détection à ±0,8 s ; une fausse détection en plus.
    const game = [300_000, 612_000, 905_000];
    const video = [395_600, 706_400, 1_000_700, 50_000];
    expect(alignOffset(video, game)).toEqual({ offsetMs: 95_233, matches: 3 });
    expect(alignOffset([395_000], game)).toBeNull(); // une seule mort : trop ambigu
    expect(alignOffset([10_000, 20_000], [500_000, 900_000])).toBeNull(); // aucun alignement cohérent
  });
});
