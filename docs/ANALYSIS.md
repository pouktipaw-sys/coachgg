# Analyse vidéo assistée (phase 4) — `auto-0.1.0`, expérimentale

## Principe
Des **signaux visibles dans l'image** sont mesurés, des **règles versionnées** les transforment en propositions de moments, et **le propriétaire valide ou rejette** chaque proposition. Rien n'est publié automatiquement.

Aucune lecture mémoire, aucun modèle entraîné, aucune donnée Riot, aucun GPU.

## Pipeline (tâche `ANALYZE_RECORDING`)
| Étape | Contenu | Statut possible |
|---|---|---|
| 1. Validation | vidéo prête, métadonnées présentes | échec définitif sinon |
| 2. Association au match | indique si un match est lié | ignorée si aucun |
| 3. Synchronisation | temps de jeu ajouté aux observations si `gameStartOffsetMs` est défini | ignorée sinon |
| 4–5. Extraction / sélection | `analysis/analyze.py` : échantillonnage à 2 i/s (FFmpeg → NumPy/OpenCV), signaux, séquences, planches de contexte | avertissement si minimap non définie |
| 6–8. Propositions | `src/lib/analysis/rules.ts` (pur, testé) : observations, interprétation, alternatives, confiance | |
| 9–10. Annotations et enregistrement | brouillons `AUTOMATIC` + annotations + planche JPEG | |

Statut final : `NEEDS_REVIEW` (propositions à valider), `PARTIAL` (avertissement, rien trouvé), `SUCCEEDED` (rien trouvé), `FAILED`, `CANCELLED`. Chaque étape est tracée avec sa durée (`AnalysisJob.result.steps`), même en cas d'échec. Coût externe : 0 (traitement local), temps de traitement enregistré.

Robustesse : sous-processus Python sans shell, délai max (`ANALYSIS_TIMEOUT_SEC`), threads limités, annulation (processus tué), dossier temporaire supprimé, sortie validée par zod (noms de fichiers compris), 2 essais max ; Python/OpenCV absent = échec définitif « non configurée ». **Idempotent** : une relance remplace les brouillons automatiques précédents et ne recrée pas une proposition déjà validée ou rejetée. L'analyse se lance automatiquement après le traitement si le worker dispose de Python/OpenCV ; elle peut être relancée avec un contexte de 6, 10 ou 15 s.

## Signaux et règles
| Signal | Mesure | Proposition |
|---|---|---|
| Écran grisé | saturation **médiane** de la vue de jeu (hors interface du bas ; insensible aux webcams et chats de stream restés en couleur) : segment délimité sous 45 % de la référence de la vidéo, passant au moins une fois sous 35 %, durant ≥ 2 s (≥ 1,5 s s'il est coupé par la fin de la vidéo). Calé sur un vrai clip de stream : début retrouvé à l'image près | « Mort probable, contexte à revoir » — type *Situation intéressante* (jamais *erreur*), confiance « ne permet pas de conclure » |
| + marqueurs rouges minimap | hausse ≥ 1 % de la surface de la minimap **avant** l'écran grisé, par rapport aux 20 s précédentes ; centroïde des nouveaux pixels rouges | confiance faible, catégorie Vision, une alternative **conditionnelle** avec ses limites, annotation minimap « marqueurs rouges (non identifiés) » |
| Forte activité | mouvement > 2,5 × la médiane pendant ≥ 2 s (hors fenêtres de mort), 3 max | « Engagement probable » — aucune décision évaluée |

Pour chaque séquence : planche de 8 images couvrant le contexte **avant** l'événement, mesures brutes consultables (`autoEvidence`).

Garde-fous codés et testés : aucune mesure postérieure à l'événement n'est utilisée pour juger la décision ; instant de pause placé par défaut 2 s avant l'écran grisé et signalé comme tel ; confiance jamais « élevée ».

## Revue et visibilité
- Brouillons visibles **uniquement par le propriétaire** (lecteur, badge « proposition automatique — à valider »). Les personnes avec qui la vidéo est partagée ne voient que les moments validés.
- Valider → moment publié (« automatique, validée », « et corrigée » si modifié). Rejeter → masqué avec ses annotations, conservé pour la mesure.
- Administration : taux de validation par version de règles = validées / (validées + rejetées).

## Mesurer la précision
La précision sur de vraies parties doit être **mesurée**, pas supposée. Trois outils :

1. **Dans l'application** (page d'une vidéo, panneau « Mesurer la précision ») :
   - *Vérité terrain manuelle* : mettre la vidéo en pause à l'instant d'une mort réelle, puis « Marquer une mort ».
   - *Vérité terrain Riot* : « Importer les morts (timeline Riot) » — morts du joueur issues de MATCH-V5 `/timeline` (`CHAMPION_KILL` dont il est la victime), converties en temps vidéo. Conditions : clé API, vidéo liée à un match importé de Riot, vidéo synchronisée (onglet « Synchro »). Prioritaire sur le marquage manuel.
   - Résultat : précision (détections correctes / détections), rappel (morts retrouvées / morts réelles), F1, décalage moyen, liste cliquable des morts manquées et des fausses alertes.
2. **Administration** : agrégat par version de règles (somme des vrais/faux positifs sur toutes les vidéos étiquetées), sans accès au contenu des vidéos.
3. **Banc d'essai hors ligne**, sans base ni réseau :
   ```bash
   npm run benchmark:analysis -- ./mon-jeu-de-test --out rapport.json
   ```
   Le dossier contient les vidéos et `labels.json` (`{"partie.mp4": {"deaths": ["3:12", 701.5], "minimap": {"x":0.81,"y":0.69,"w":0.19,"h":0.31}}}`, temps vidéo).

Règles d'appariement : une détection « écran grisé » est correcte si elle commence à ±2,5 s d'une mort réelle ; appariement un pour un (deux détections pour une mort = 1 correcte + 1 fausse alerte). Les détections brutes de chaque analyse sont conservées (`AnalysisJob.result.detections`) ; les analyses antérieures doivent être relancées.

Protocole recommandé avant de sortir du statut expérimental : au moins 20 parties complètes, de rôles et résolutions variés, étiquetées par la timeline Riot si possible ; publier version des règles, nombre de vidéos, précision, rappel. Recueillir le consentement des joueurs dont les vidéos composent le jeu de test.

## Limites connues
- Précision sur de **vraies parties : non mesurée**. Tests réalisés sur une vidéo de synthèse contrôlée. La revue humaine sert de mesure de terrain.
- L'écran grisé peut avoir d'autres causes (effets, menus). Le mouvement ne distingue pas un combat d'un déplacement de caméra. Les marqueurs rouges peuvent être des signaux ou des structures.
- Résolution d'analyse de 320 px : position minimap approximative (± 1/10 de la minimap).
- La zone minimap doit être définie à la main (pas de détection automatique).
- Non couvert : placement, compétences, ressources, objectifs, positions des champions.

## Lancer
```bash
python3 -m venv .venv-analysis && .venv-analysis/bin/pip install -r analysis/requirements.txt
```
```bash
.venv-analysis/bin/python -m unittest discover -s analysis
```


## Timeline Riot (analyse précise)

Quand la vidéo est **liée à une partie importée de Riot** et **synchronisée** avec l'horloge du jeu, chaque mort réelle du joueur
(timeline MATCH-V5) devient un moment, même si l'image ne l'a pas détectée :

- **Faits mesurés** : tueur et assistants, alliés à portée (moins de 2 500 unités), allié le plus proche, balises posées dans les
  3 minutes, moitié de carte, objectif pris par l'ennemi dans la minute, échange (le tueur meurt dans les 15 s), écart d'or.
- **Diagnostic** (`diagnoseDeath`, testé) : objectif perdu → rotation ; isolé face à 2 ennemis ou plus → placement ; dans la moitié
  adverse sans balise → vision ; infériorité numérique → engagement ; échange → non classé comme erreur.
- **Schéma sur la minimap** (si la zone minimap est définie) : lieu de la mort, ennemis, alliés à portée, flèche de repli vers la base.
- **Limites** : la timeline donne les positions **une fois par minute** ; entre deux, elles sont interpolées (signalé dans le texte).
  Le lieu de la mort, le tueur et les assistants sont exacts.
- Une mort détectée à l'image (écran grisé) à moins de 5 s est fusionnée avec la mort réelle. Avec une clé Anthropic, Claude reçoit
  ces faits mesurés en plus des images et conserve le schéma minimap.
- La timeline compacte est stockée sur le match à l'import (`Match.timelineFacts`), ou récupérée à la demande pour les anciens matchs.

### Liaison et synchronisation automatiques

Avant l'étape timeline, l'analyse tente de se passer de toute manipulation :

1. **Liaison** (si la vidéo n'est liée à aucune partie) : la date d'enregistrement est lue dans le nom du fichier
   (client LoL « … 2024-09-18 19-24-33 », OBS, ShadowPlay, Outplayed…) ou fournie par l'application PC ; la partie Riot
   importée qui contient cette heure (± 10 min) est retenue. L'heure du fichier est l'heure locale du PC qui fait tourner CoachGG.
   Sans date dans le nom (fichier renommé), les indices suivants sont essayés dans l'ordre : date de création inscrite dans
   la vidéo (tag `creation_time`, valeurs par défaut 1904/1970 écartées), puis date de modification du fichier envoyée par le
   navigateur (≈ fin de l'enregistrement). Une partie plus courte que la vidéo (− 10 min de marge) n'est jamais retenue.
   La note de l'étape indique l'indice utilisé ; en cas d'échec, elle dit pourquoi (aucune partie importée, ou dates essayées).
2. **Synchronisation** (si le décalage est inconnu) : les morts vues à l'image (écrans grisés) sont alignées sur les morts
   réelles de la timeline ; le décalage est accepté avec **au moins 2 concordances** à ± 1,5 s, puis affiné (moyenne).

Sinon, l'étape l'indique et les réglages manuels (encadré « Informations », onglet « Synchro ») restent disponibles.

### Précision des positions (v2)

- **Repères** : en plus des positions minute par minute, chaque kill sert de repère (victime : position exacte ;
  tueur et assistants : près du lieu du kill), et chaque **réapparition** replace le joueur à sa fontaine.
- **En vie ou mort** : temps de mort estimé selon le niveau (barème par niveau, allongé après 15 min) ; un joueur
  mort n'est jamais compté comme « allié à portée » ni comme « absent ».
- Chaque position indique sa fiabilité (écart au repère le plus proche) ; au-delà de 30 s, la confiance baisse.

### Mauvais moments sans mort

- **Absent d'un combat perdu** : combat = 3 kills ou plus à moins de 15 s et 3 500 unités les uns des autres ; perdu
  d'au moins 2 morts d'écart ; joueur en vie, non impliqué, à plus de 5 000 unités.
- **Objectif pris loin de toi** : dragon, Nashor, Héraut ou larves pris par l'ennemi alors que le joueur, en vie, était
  à plus de 6 000 unités de la fosse (sans doublon avec un combat perdu dans les 30 s).
- Chaque moment : schéma minimap (ta position, le combat ou l'objectif, flèche « Rejoindre »), conseil, clip
  « Occasion manquée ». L'interprétation rappelle qu'il faut vérifier (tu faisais peut-être autre chose d'utile).

### Erreurs sans mort : retours à la base et sbires (`src/lib/riot/macroFacts.ts`)

Mesurées par la timeline Riot v2 (or en poche, sbires et position une fois par minute ; achats et objectifs à la seconde).
Une timeline stockée en v1 (sans sbires ni achats) est récupérée à nouveau si la clé Riot le permet.

| Erreur | Règle | Ce qui est montré |
|---|---|---|
| **Retour raté** | ≥ 1 500 or en poche, en vie, pendant ≥ 2 min sans passer à la boutique (après 3:00, hors 2 dernières minutes) | or gardé, durée, mort éventuelle avec cet or |
| **Retour au mauvais moment** | achat à la base dans les 75 s avant un objectif majeur pris par l'ennemi | remplace le moment « objectif pris loin de toi » (même événement, cause plus précise) ; schéma : ta position, l'objectif, flèche « Rester pour l'objectif » |
| **Sbires perdus** | ≥ 2 minutes de suite à ≤ 40 % de ton rythme habituel de la partie (médiane), en vie, perte ≥ 8 sbires ; support ignoré ; une minute basse seule = retour à la base normal | sbires perdus, or estimé (20 or par sbire), trajet estimé sur la minimap |
| **Bilan de voie** | écart de sbires et d'or avec l'adversaire du même rôle à 10 et 15 min | première ligne des constats du bilan |

Chaque erreur devient un moment « Erreur » (catégorie Ressources ou Rotations, confiance moyenne), un clip, des pastilles
chiffrées, et compte dans la gravité et les erreurs récurrentes du bilan. Limites : une mesure d'or et de sbires par
minute ; une absence de sbires peut être un choix utile (objectif, déplacement pour un kill) : l'interprétation le rappelle.
Le placement fin en combat (sans mort) ne se mesure pas avec la timeline : seule l'analyse des images (IA) peut l'aborder.

### IA : minimap agrandie

Quand la zone minimap est connue, Claude reçoit en plus une image 512 × 512 de la minimap 2,5 s avant la mort, avec la
consigne de compter ennemis et alliés ; les faits mesurés de la timeline font foi.

### Reconstitution tactique sur la minimap

Pour chaque mort (et chaque moment « absent »), les trajets estimés des joueurs concernés sont dessinés sur la minimap
**au rythme de la vidéo** : toi (doré), les ennemis impliqués (rouge), les alliés à portée (bleu), sur les 15 s qui
précèdent. Ce sont des annotations « trajet horodaté » (`geometry.times`, un point par seconde, positions interpolées
entre les repères de la timeline) ; le lecteur web et l'export vidéo utilisent le même calcul (`timedProgress`).
Dans le récap et les exports, elles apparaissent dans la minimap agrandie.

## IA experte (v2)

**Faits experts mesurés (sans clé IA)** : niveaux (toi et moyenne des ennemis impliqués), or non dépensé à la dernière
minute, durée de la mort, état du dragon et du Nashor (disponibles ou dans la minute, d'après les prises précédentes).

**Diagnostic** : une cause principale (échange, objectif perdu, retard de 2 niveaux, isolé, sans vision, infériorité,
or non dépensé) et la liste des **facteurs aggravants** mesurés. Chaque mort enregistre ses facteurs (`flags`).

**Claude (si clé)** : méthode de coach (grille vague / vision / rapport de force / sorts visibles / position, puis faits
mesurés, puis 1 à 3 causes classées), preuves citées pour chaque affirmation (« image n », « minimap », « faits »),
incertitudes déclarées. Garde-fous dans le code : preuves citant une image inexistante rejetées, confiance « moyenne »
seulement avec 2 preuves valides, cause mesurée par la timeline prioritaire sur celle de l'IA.

**Bilan** : erreurs récurrentes mesurées (facteur présent dans au moins 2 moments) en tête ; la priorité n°1 en traite une.
Avec Claude, il reçoit les facteurs et faits de chaque moment.

## Banc d'essai et calibrage (précision mesurée)

`npm run bench:corpus -- dossier` génère 20 vidéos de type LoL avec leurs bonnes réponses (`analysis/bench/make_corpus.py`) :
1080p, 720p, 1440p, ultra-large, 60 i/s, compression forte, webcam et chat de streamer, mort courte, mort coupée par la
fin, morts rapprochées, minimap à gauche, petite et grande, et des **pièges** : scène sombre, tableau des scores,
boutique, fondu au noir, partie sans mort. L'écran de mort grise le jeu en ~0,3 s, l'interface et la minimap restent en
couleur (comme dans LoL). `npm run bench:run -- dossier` mesure : morts trouvées, fausses alertes, manquées, écart sur
le début de la mort, recouvrement de la minimap détectée (IoU). Fonctionne aussi sur de vraies vidéos étiquetées
(`labels.json` : `deaths` en secondes, `minimap` facultatif).

| Mesure (20 vidéos, 24 morts) | Avant | Après |
|---|---|---|
| Morts trouvées (rappel) | 23/24 (96 %) | **24/24 (100 %)** |
| Fausses alertes (pièges compris) | 0 | **0** |
| Écart moyen sur le début de la mort | 207 ms (max 267) | **47 ms (max 50)** |
| Minimap trouvée automatiquement | — (réglage à la main) | **20/20, recouvrement 98,8 % (1 à 2 px)** |

Ce qui a changé :
- **Début de la mort à l'image près** : affinage à 60 i/s, puis on remonte au début du fondu ; une **chute brutale**
  est le début elle-même (vérifié sur un vrai clip de stream : une petite baisse de décor 0,5 s avant la mort ne doit
  pas être prise pour le début — 9,217 s et 28,217 s pour des débuts réels à 9,20 s et 28,23 s).
- Mort courte qui s'arrête moins d'1 s avant la fin d'un clip : comptée.
- **Minimap détectée automatiquement** : bords fixes (persistants) sur 7 images, recherche du carré le plus net dans un
  coin bas, puis chaque côté calé au **milieu du trait du cadre** (deux bords : extérieur et intérieur). Si aucun cadre
  net (webcam par-dessus, montage de plusieurs streamers), rien n'est inventé : réglage à la main.
- Zone détectée **enregistrée** sur la vidéo quand aucune n'a été réglée : schémas, trajets et encart minimap des clips
  disponibles sans réglage.
- **Trajets** sur la minimap : 4 points par seconde (au lieu de 1), fin du trajet conservée (la plus proche du moment).

Limites : vidéos du banc **synthétiques** (règles calées dessus + un vrai clip) ; à confirmer sur de vraies parties
complètes avec l'outil d'évaluation intégré (« Importer les morts (timeline Riot) »).
