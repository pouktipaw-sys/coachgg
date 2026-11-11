import { describe, expect, it } from "vitest";
import { tallyVotes, validateBallot } from "@/lib/votes";

const v = (voterId: string, targetId: string, score: number, mvp = false, awards: string[] = []) => ({ voterId, targetId, score, mvp, awards });

describe("votes entre coéquipiers", () => {
  it("élit le MVP à la majorité, moyenne des notes, gagnants par catégorie", () => {
    const t = tallyVotes([v("a", "B", 8, true, ["CARRY"]), v("a", "C", 6, false, ["VISION"]), v("c", "B", 9, true, ["CARRY"]), v("b", "C", 7, true)]);
    expect(t.mvp).toEqual({ targetId: "B", votes: 2 });
    expect(t.perTarget.B).toMatchObject({ avgScore: 8.5, voters: 2, mvpVotes: 2 });
    expect(t.perTarget.C!.avgScore).toBe(6.5);
    expect(t.awards).toEqual({ CARRY: "B", VISION: "C" });
    expect(t.voters).toBe(3);
  });

  it("égalité de votes MVP départagée par la note moyenne, sinon égalité déclarée", () => {
    expect(tallyVotes([v("a", "B", 9, true), v("b", "A", 7, true)]).mvp).toEqual({ targetId: "B", votes: 1 });
    expect(tallyVotes([v("a", "B", 8, true), v("b", "A", 8, true)]).mvp).toEqual({ tie: ["B", "A"] });
    expect(tallyVotes([v("a", "B", 8)]).mvp).toBeNull();
    expect(tallyVotes([v("a", "B", 8, false, ["CLUTCH"]), v("b", "A", 8, false, ["CLUTCH"])]).awards.CLUTCH).toBeNull();
  });

  it("refuse un bulletin incohérent", () => {
    const ok = ["B", "C"];
    expect(validateBallot([{ targetId: "B", mvp: true, awards: ["CARRY"] }, { targetId: "C", mvp: false, awards: ["VISION"] }], ok)).toBeNull();
    expect(validateBallot([{ targetId: "B", mvp: true, awards: [] }, { targetId: "C", mvp: true, awards: [] }], ok)).toMatch(/Un seul MVP/);
    expect(validateBallot([{ targetId: "B", mvp: false, awards: ["CARRY"] }, { targetId: "C", mvp: false, awards: ["CARRY"] }], ok)).toMatch(/un seul joueur/);
    expect(validateBallot([{ targetId: "Z", mvp: false, awards: [] }], ok)).toMatch(/coéquipiers/);
    expect(validateBallot([{ targetId: "B", mvp: false, awards: ["NUL"] }], ok)).toMatch(/inconnue/);
  });
});
