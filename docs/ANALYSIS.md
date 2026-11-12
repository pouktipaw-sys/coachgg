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
| Écran grisé | saturation de la vue de jeu (hors interface du bas) < 35 % de la médiane de la vidéo pendant ≥ 3 s | « Mort probable, contexte à revoir » — type *Situation intéressante* (jamais *erreur*), confiance « ne permet pas de conclure » |
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
