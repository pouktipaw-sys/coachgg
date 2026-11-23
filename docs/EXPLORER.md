# Explorer : recherche de joueur, partie en cours, champions, stats avancées

Fonctions de type « site de statistiques », construites sur les **API publiques de Riot** et les données officielles
du jeu (Data Dragon, en français). Code : `src/server/riot/explorer.ts`, `src/server/riot/ddragon.ts`, `src/lib/riot/insights.ts`.

| Page | Contenu | Appels Riot |
|---|---|---|
| `/app/players` | Rang (solo/duo, flexible), résumé des 20 dernières parties (victoires, KDA, sbires/min), champions, rôle principal, maîtrises, liste des parties (participation aux éliminations, adversaire de voie) | compte, rang, 20 identifiants, parties (mises en cache dans `RiotMatchCache`), maîtrises |
| `/app/live` | Partie en cours : 10 joueurs, champion, sorts d'invocateur, rang et taux de victoire classé, maîtrise du champion joué, champions bannis | SPECTATOR-V5, puis rang + maîtrise par joueur (≈ 21 appels) |
| `/app/champions`, `/app/champions/[id]` | Grille avec recherche et filtre par classe ; fiche : sorts (récupération, description officielle), conseils officiels pour et contre, **tes** statistiques, **tes** objets finis et runes clés avec ton taux de victoire, **tes** matchups, tes amis sur ce champion | aucun (Data Dragon + base CoachGG) |
| `/app/insights` | Tes résultats par champion, par rôle, adversaires de voie les plus durs et les plus faciles (≥ 2 parties) | aucun (base CoachGG) |

## Honnêteté des chiffres

- Tout est calculé sur des **parties réelles** ; le nombre de parties accompagne chaque pourcentage, grisé sous 3 parties.
- Les « builds » sont ceux de **tes** parties (et de tes amis), pas une méta calculée sur des millions de parties :
  ce serait une autre infrastructure (clé Riot Production, collecte continue, gros stockage).
- Runes stockées à l'import depuis cette version (`MatchStatistics.runes`) ; les parties plus anciennes n'en ont pas.

## Ce qui n'est volontairement pas fait

- **Aucune aide pendant la partie** (minuteurs de jungle, sorts ennemis, superposition sur le jeu) : interdit par les
  règles de Riot pour les applications tierces. La page « Partie en cours » ne montre que des informations publiques
  disponibles avant de jouer.
- Import automatique des runes dans le client : nécessite l'application PC (en test) et l'accord des règles de Riot.
