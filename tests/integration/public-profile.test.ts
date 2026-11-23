import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { publicProfile, setPublicProfile } from "@/server/publicProfile";
import { createManualMatch } from "@/server/matches/service";
import { makeUser } from "./helpers";

describe("profil public partageable", () => {
  it("désactivé par défaut ; activé explicitement ; le lien cesse de fonctionner une fois désactivé", async () => {
    const u = await makeUser("Morjinho Pro");
    expect((await prisma.playerProfile.findUnique({ where: { userId: u.id } }))?.publicProfile ?? false).toBe(false);
    const on = await setPublicProfile(u.id, true);
    expect(on.slug).toMatch(/^morjinho-pro-[0-9a-f]{4}$/);
    await createManualMatch(u.id, {
      durationSec: 1800, gameMode: "RANKED_SOLO",
      participants: [{ isMe: true, championName: "Ahri", role: "MIDDLE", teamSide: 100, win: true, kills: 6, deaths: 3, assists: 8, creepScore: 240 }],
    });
    const p = (await publicProfile(on.slug!))!;
    expect(p).toMatchObject({ displayName: "Morjinho Pro", summary: { games: 1, winrate: 100 }, champions: [{ name: "Ahri" }] });
    expect(JSON.stringify(p)).not.toMatch(/@|email|recording|video/i); // aucune donnée privée
    const off = await setPublicProfile(u.id, false);
    expect(off.slug).toBe(on.slug); // même lien si on le réactive
    expect(await publicProfile(on.slug!)).toBeNull();
    expect(await publicProfile("inexistant-0000")).toBeNull();
  });
});
