// Partie classée simulée (MATCH-V5) pour les tests des statistiques méta.
import type { RiotMatch } from "@/server/riot/client";

const roles = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
export function fakeRanked(id: string, blueWins: boolean, champs: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], durationSec = 1800): RiotMatch {
  return {
    metadata: { matchId: id },
    info: {
      gameCreation: 1, gameStartTimestamp: 1, gameDuration: durationSec, gameEndTimestamp: 2, gameVersion: "15.20.512.3456", queueId: 420, platformId: "EUW1",
      teams: [{ teamId: 100, bans: [{ championId: 99, pickTurn: 1 }, { championId: -1, pickTurn: 2 }] }, { teamId: 200, bans: [{ championId: 98, pickTurn: 6 }] }],
      participants: champs.map((c, i) => ({
        puuid: `p${i}`, championName: `C${c}`, championId: c, teamPosition: roles[i % 5], teamId: i < 5 ? 100 : 200, win: i < 5 ? blueWins : !blueWins,
        kills: 1, deaths: 1, assists: 1, item0: 3089, item1: 3020, item2: 0, summoner1Id: 14, summoner2Id: 4, riotIdGameName: `Joueur${i}`, riotIdTagline: "EUW",
        perks: { styles: [{ style: 8100, selections: [{ perk: 8112 }, { perk: 8139 }, { perk: 8138 }, { perk: 8135 }] }, { style: 8000, selections: [{ perk: 9111 }, { perk: 8014 }] }], statPerks: { offense: 5008, flex: 5008, defense: 5011 } },
      })),
    },
  };
}


/** Timeline simulée : chaque joueur monte Q > E > W et achète 3089 puis 3020 puis 3157 (après des composants). */
export function fakeTimeline(m: RiotMatch) {
  const order = [1, 3, 2, 1, 1, 4, 1, 3, 1, 4, 3, 3, 2, 3, 2, 4]; // Q E W Q Q R Q E Q R E E W E W R
  const events = m.info.participants.flatMap((_, i) => [
    ...order.map((slot, k) => ({ type: "SKILL_LEVEL_UP", timestamp: 60_000 * (k + 1) + i, participantId: i + 1, skillSlot: slot, levelUpType: "NORMAL" })),
    ...[1058, 3089, 1001, 3020, 3157].map((itemId, k) => ({ type: "ITEM_PURCHASED", timestamp: 300_000 * (k + 1) + i, participantId: i + 1, itemId })),
  ]);
  return { metadata: { matchId: m.metadata.matchId, participants: m.info.participants.map((p) => p.puuid) }, info: { frames: [{ timestamp: 0, events }] } };
}
