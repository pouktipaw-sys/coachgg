import { describe, expect, it } from "vitest";
import { expectedContainer, extensionOf, mimeAcceptable, sniffContainer } from "@/server/video/formats";

describe("validation des formats vidéo", () => {
  it("reconnaît les extensions acceptées", () => {
    expect(extensionOf("partie.MP4")).toBe("mp4");
    expect(extensionOf("partie.mkv")).toBe("mkv");
    expect(extensionOf("partie.avi")).toBeNull();
    expect(extensionOf("script.mp4.exe")).toBeNull();
  });

  it("filtre les types MIME déclarés", () => {
    expect(mimeAcceptable("video/mp4")).toBe(true);
    expect(mimeAcceptable("")).toBe(true);
    expect(mimeAcceptable("text/html")).toBe(false);
  });

  it("détecte la signature binaire du conteneur", () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const ebml = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    expect(sniffContainer(mp4)).toBe("isobmff");
    expect(sniffContainer(ebml)).toBe("ebml");
    expect(sniffContainer(new TextEncoder().encode("<html><body>"))).toBeNull();
    expect(expectedContainer("webm")).toBe("ebml");
    expect(expectedContainer("mov")).toBe("isobmff");
  });
});
