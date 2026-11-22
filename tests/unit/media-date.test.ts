import { describe, expect, it } from "vitest";
import { parseCreationTime } from "@/server/video/ffmpeg";

describe("date inscrite dans la vidéo", () => {
  it("garde une date plausible, écarte les valeurs par défaut et le futur", () => {
    const now = Date.parse("2026-11-22T12:00:00Z");
    expect(parseCreationTime("2026-11-20T18:01:02.000000Z", now)?.toISOString()).toBe("2026-11-20T18:01:02.000Z");
    expect(parseCreationTime("1970-01-01T00:00:00.000000Z", now)).toBeNull();
    expect(parseCreationTime("1904-01-01T00:00:00Z", now)).toBeNull();
    expect(parseCreationTime("2030-01-01T00:00:00Z", now)).toBeNull();
    expect(parseCreationTime(undefined, now)).toBeNull();
    expect(parseCreationTime("pas une date", now)).toBeNull();
  });
});
