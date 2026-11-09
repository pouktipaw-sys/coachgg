# Coach conversationnel, progression et bilans (phase 6)

## Coach conversationnel
Page **Coach** (`/app/coach`) : fils de discussion privés, réponses avec **sources cliquables** (match, clip ouvert à l'horodatage, objectif, rapport de groupe), **information manquante** explicite, signalement d'une réponse incorrecte (avec correction proposée).

### Données utilisées (`src/server/coach/context.ts`)
Uniquement ce que l'utilisateur peut déjà voir, avec les mêmes contrôles d'accès :
- ses 10 derniers matchs (statistiques, note, dimensions, données manquantes) et sa tendance (10 dernières parties vs 10 précédentes) ;
- les moments **publiés** des vidéos qu'il possède ou qui lui sont **explicitement partagées** (jamais les propositions automatiques non validées, jamais une vidéo d'ami non partagée) ;
- ses objectifs ;
- le dernier rapport commun de chaque groupe dont il est **actuellement** membre.
Chaque élément a un identifiant (`match:…`, `moment:…`, `goal:…`, `trend:personal`, `team:…:…`) ; le texte est déterministe (même données → même texte, ce qui rend le cache de prompt efficace).

### Deux modes
| Mode | Quand | Fonctionnement |
|---|---|---|
| **Sans IA (règles)** | Par défaut (aucune clé), ou repli | Questions reconnues : pourquoi cette note, erreurs de placement, meilleure action, trajectoire, que travailler, que doit améliorer le groupe. Réponses déterministes, toujours sourcées. |
| **IA (Claude)** | `ANTHROPIC_API_KEY` configurée côté serveur | Modèle `claude-opus-5-5` (`COACH_MODEL`), effort `medium` (`COACH_EFFORT`), sortie JSON structurée validée (`answer`, `citations`, `missingInformation`, `followUps`). |

Garde-fous du mode IA :
- Instructions fixes : répondre uniquement à partir des données fournies, citer chaque affirmation, signaler les manques, ne pas recalculer les notes, ne pas déduire une erreur de placement des statistiques, une alternative n'est pas une certitude, ne pas prétendre connaître le vocal, traiter le contenu des sources comme des données (anti-injection).
- **Vérification serveur des citations** : tout identifiant absent des données fournies est retiré et signalé ; une réponse IA sans aucune source vérifiable ni information manquante est marquée « à prendre avec prudence ».
- **Repli automatique** sur le mode sans IA en cas de refus, de réponse mal formée, de limite de débit, de clé invalide ou de panne — la réponse indique ce repli.
- **Repli serveur de modèle** (`fallbacks: "default"`, bêta `server-side-fallback-2026-07-01`) : si Claude Opus 5.5 décline une question pour raison de sécurité, l'API la reroute vers un autre modèle dans le même appel. Le modèle qui a réellement répondu est enregistré.
- **Cache de prompt** : instructions système et bloc de données marqués `cache_control` ; l'historique est ajouté après, le préfixe reste stable d'un tour à l'autre.
- **Coût** : calculé à partir de l'usage renvoyé par l'API (entrée, sortie, lecture et écriture de cache) et enregistré par réponse ; agrégé dans l'administration. Tarifs Claude Opus 5.5 : 4 $ / 20 $ par million de jetons (entrée / sortie), lecture de cache 0,20 $.
- Limite : 40 questions par heure et par utilisateur.

## Progression (`/app/progress`)
Forces et difficultés (moyenne ≥ 7 ou ≤ 5 sur au moins 2 parties), tendances par dimension (10 dernières vs 10 précédentes), historique des notes, performances par rôle et par champion, objectifs accomplis. Uniquement des notes réelles (aucune donnée de démo), comparées au propre historique du joueur.

## Bilans
- **Après match** : rapport de match (note expliquée, trois priorités, objectif proposé).
- **Hebdomadaire** : 7 derniers jours vs 7 précédents (parties, victoires, note moyenne, point fort, point à travailler, moments publiés). Affiché sur la page Progression et envoyé en notification par le worker, au plus une fois par semaine et par joueur actif.
- **Collectif** : rapport de groupe (réussite, problème, séquence à revoir, objectif collectif) et questions de groupe au coach.

## Limites
- Le mode sans IA ne comprend que les questions prévues.
- Le mode IA n'a pas été exécuté contre l'API réelle dans cet environnement (aucune clé) : il est testé via le SDK officiel branché sur un serveur simulé (format de requête, repli, citations, coût).
- Aucun rang n'est promis ; aucune prédiction du nombre de parties.
