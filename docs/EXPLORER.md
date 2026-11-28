# Explorer : recherche de joueur, partie en cours, champions, stats avancées

Fonctions de type « site de statistiques », construites sur les **API publiques de Riot** et les données officielles
du jeu (Data Dragon, en français). Code : `src/server/riot/explorer.ts`, `src/server/riot/ddragon.ts`, `src/lib/riot/insights.ts`.

| Page | Contenu | Appels Riot |
|---|---|---|
| `/app/players` | Rang (solo/duo, flexible), résumé des 20 dernières parties (victoires, KDA, sbires/min), champions, rôle principal, maîtrises, liste des parties (participation aux éliminations, adversaire de voie) | compte, rang, 20 identifiants, parties (mises en cache dans `RiotMatchCache`), maîtrises |
| `/app/live` | Partie en cours : 10 joueurs, champion, sorts d'invocateur, rang et taux de victoire classé, maîtrise du champion joué, champions bannis | SPECTATOR-V5, puis rang + maîtrise par joueur (≈ 21 appels) |
| `/app/champions`, `/app/champions/[id]` | Grille avec recherche et filtre par classe ; fiche : sorts (récupération, description officielle), conseils officiels pour et contre, **tes** statistiques, **tes** objets finis et runes clés avec ton taux de victoire, **tes** matchups, tes amis sur ce champion | aucun (Data Dragon + base CoachGG) |
| `/app/insights` | Tes résultats par champion, par rôle, adversaires de voie les plus durs et les plus faciles (≥ 2 parties) | aucun (base CoachGG) |

## Classement et statistiques « méta »

| Page | Contenu |
|---|---|
| `/app/leaderboard` | Ligues Challenger, Grand maître, Maître (solo/duo, flexible) : 100 premiers, PL, taux de victoire ; Riot ID des premiers résolus (cache 24 h) |
| `/app/tierlist` | Par rôle et patch : palier S+ à D, victoires, sélection, bannissement, parties |
| `/app/champions/[id]` | Section méta : objets les plus construits, page de runes la plus jouée, fort / faible contre |
| `/app/draft` | Aide à la sélection : contres de l'adversaire de voie, meilleurs choix, bannissements |

**Collecte** (`src/server/meta.ts`, tâche `META_CRAWL`, **désactivée par défaut**) : `META_CRAWL_PLATFORMS="EUW1"`
dans `.env`. Une fois par heure et par serveur, le worker prend les joueurs Challenger et Grand maître, leurs dernières
parties classées solo/duo, et additionne par patch/champion/rôle : parties, victoires, bannissements, objets, pages de
runes complètes, matchups. Partie comptée une seule fois ; parties de moins de 15 min ignorées ; aucune donnée de
compte conservée. Clé de développement : ~100 requêtes / 2 min → quelques centaines de parties par heure ;
clé « Production » : même code, beaucoup plus vite (`META_CRAWL_MATCHES_PER_RUN`).

**Tier list** : taux de victoire ajusté (a priori de 150 parties à 50 %, pour qu'un petit échantillon chanceux ne
passe pas devant un champion solide), petit bonus de popularité, seuil minimum (20 parties et 0,3 % du patch).
Paliers par centile : S+ 5 %, S 15 %, A 35 %, B 65 %, C 85 %, D.

### Builds complets, modes, meilleurs joueurs, patchs

- **Builds** : sorts d'invocateur, **ordre de montée des sorts** (sort monté à 5 points en premier, via la timeline),
  **ordre des 3 premiers objets finis**, page de runes complète, objets les plus construits, fort / faible contre.
- **Modes** : `META_CRAWL_MODES="RANKED,ARAM,ARENA"` ; ARAM et Arena sans rôle ; Arena : victoire = top 4.
  Onglets Classée / ARAM / Arena sur la tier list et les fiches champion.
- **Meilleurs joueurs d'un champion** : joueurs des parties classées collectées (≥ 5 parties), classement ajusté au
  nombre de parties (données publiques de Riot : Riot ID, parties, victoires).
- **Notifications de patch** : chaque heure, la version du jeu est vérifiée ; à un nouveau patch, chaque joueur reçoit
  les changements chiffrés (statistiques de base, récupérations, coûts, portées) de ses champions préférés et des 3 plus
  joués sur 60 jours, comparés entre les données officielles des deux versions. Les textes ne sont pas analysés.
- **Application PC** : au verrouillage, le message rappelle l'ordre de montée des sorts ; l'ensemble d'objets suit
  l'ordre d'achat ; au début de la partie, l'interface locale affiche l'écran de chargement (10 joueurs, rang,
  victoires, maîtrise). **Pas de bannissement, de choix ni de verrouillage automatiques** (actions du joueur).

### Par rang et par serveur, contres, synergies, LP, volume

- **Seaux** : chaque partie est comptée dans 4 seaux (global, serveur, rang, rang + serveur). Clés `15.20`,
  `15.20~P:EUW1`, `15.20~T:GOLD`, `15.20~T:GOLD~P:EUW1`. Le rang est celui du joueur par lequel la partie a été trouvée.
  `META_CRAWL_TIERS="ALL"` collecte de Fer à Challenger (LEAGUE-EXP-V4) ; filtres Rang / Serveur sur la tier list.
- **Volume** : limiteur partagé qui suit les quotas renvoyés par Riot (`X-App-Rate-Limit`) : la collecte va aussi vite
  que la clé le permet, sans erreurs 429. `META_CRAWL_MATCHES_PER_RUN` (jusqu'à 100 000) et `META_CRAWL_EVERY_MIN`.
  Les « millions de parties » demandent une **clé Production** et plusieurs serveurs : le code est prêt, le quota non.
- **Nouveau patch** : collecte immédiate supplémentaire ; la tier list affiche le patch précédent tant que le nouveau
  n'a pas 200 parties, avec un bandeau « nouveau patch en cours de collecte ».
- **Contre un adversaire** : résultat du matchup, page de runes et ordre des objets les plus joués contre ce champion.
- **Synergies** : par rôle allié, les 3 champions avec qui le champion gagne le plus (≥ 5 parties, taux ajusté).
- **Suivi des LP** : photo du rang à chaque actualisation où il change ; courbe sur une échelle continue
  (Fer IV 0 PL = 0, 100 par division, Maître et au-dessus = 2 800 + PL), gain ou perte total.

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
