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
        kills: 1, deaths: 1, assists: 1, item0: 3089, item1: 3020, item2: 0,
        perks: { styles: [{ style: 8100, selections: [{ perk: 8112 }, { perk: 8139 }, { perk: 8138 }, { perk: 8135 }] }, { style: 8000, selections: [{ perk: 9111 }, { perk: 8014 }] }], statPerks: { offense: 5008, flex: 5008, defense: 5011 } },
      })),
    },
  };
}

