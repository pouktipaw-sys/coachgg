# Note CoachGG et MVP

Code : `src/lib/scoring/` — fonctions pures, testées (`tests/unit/scoring.test.ts`).

## Note de performance `perf-1.0.0` (expérimentale)

Moyenne pondérée, **selon le rôle**, de six dimensions mesurables :

| Dimension | Mesure |
|---|---|
| Ressources | CS / minute |
| Participation | (éliminations + assistances) / éliminations de l'équipe |
| Dégâts | dégâts aux champions / total de l'équipe |
| Gestion du risque | morts / 10 min (indicateur statistique : ne dit pas *pourquoi*) |
| Vision | score de vision / minute |
| Objectifs | dégâts aux objectifs / total de l'équipe |

Chaque valeur est convertie linéairement en 0–10 entre un **plancher** et un repère **excellent** propres au rôle. Le résultat de la partie n'entre pas dans la note ; le KDA n'en est qu'une partie.

- **Données manquantes** : dimension exclue, pondérations renormalisées, listée dans le rapport. Moins de 60 % du poids mesurable → pas de note.
- **Fiabilité** : élevée / moyenne / faible / insuffisante (données partielles, partie < 15 min, rôle inconnu).
- **Progression personnelle** : séparée — écart à la moyenne des ≥ 3 parties précédentes (même rôle si possible).
- **Versionnage** : la configuration est figée dans `ScoreVersion`. Toute modification = nouvelle version ; les notes existantes restent liées à la leur.

⚠️ Les repères v1 sont des **heuristiques internes**, pas des statistiques issues d'un échantillon de joueurs. Toute comparaison externe future devra citer sa source et la taille de l'échantillon.

## MVP entre amis

- Calculé parmi les **membres du groupe présents** dans la partie (≥ 2), jamais parmi les 10 joueurs.
- Même formule pour tous → notes comparables. Membres sans note : exclus et signalés.
- **Égalité** si l'écart avec le meilleur est < 0,3 point ; écart < 1 point signalé « à interpréter avec prudence ».
- Distinctions secondaires (objectifs, vision, contribution collective, maîtrise du risque, progression) : seulement si la dimension est mesurée pour tous et l'avance ≥ 1 point. **Aucune distinction négative.**
- Le MVP de toute l'équipe (10 joueurs) n'est pas proposé.
- Les observations vidéo restent séparées des notes : un membre sans vidéo n'est pas pénalisé.

## Recommandations statistiques

Trois maximum, issues des dimensions les plus pénalisantes (< 6/10), adaptées au niveau d'explication. Elles indiquent une tendance et renvoient systématiquement à la vidéo pour juger le contexte.
