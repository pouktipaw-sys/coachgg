# Annotations et moments de coaching

Schémas : `src/lib/annotations/schema.ts` (zod, partagé client/serveur, validé côté serveur).

## Annotation (`VideoAnnotation`, schemaVersion 1)

| Champ | Description |
|---|---|
| `type` | `path` · `arrow` · `zone` · `marker` (position conseillée) · `highlight` (allié/ennemi) · `click` (clic conseillé) · `text` |
| `startMs`, `endMs` | Intervalle d'affichage (≤ 60 s). |
| `space` | `FRAME` (coordonnées normalisées dans l'image) ou `MINIMAP` (normalisées dans la zone minimap déclarée). |
| `geometry` | Selon le type : `points[]`, `from/to`, `center + r`, `at (+ r)`. Coordonnées ∈ [0,1] ; `r` relatif à la largeur de l'espace. |
| `style` | `actual` (rouge, trait plein, marqueur ✕) · `alternative` (vert, pointillés, marqueur ✓) · `danger` (hachures + !) · `ally` (bleu, pointillés, coins carrés) · `enemy` (rouge, repères en croix) · `neutral`. |
| `label` | Texte court (obligatoire pour `text`). |
| `recommendationId` | Lien vers le moment expliqué. |
| `provenance` | `MANUAL` (éditeur) ou `AUTOMATIC` (phase 4). Le lecteur affiche « Annoté manuellement ». |

Chaque style combine **couleur + forme + libellé** : rien ne dépend uniquement de la couleur.

### Ce que les annotations ne sont pas
- `FRAME` est un espace **écran**, pas le monde 3D : si la caméra bouge, l'annotation ne suit pas la scène. L'éditeur le rappelle ; pour une trajectoire longue, utiliser `MINIMAP`. Une projection monde→écran (caméra/perspective) n'est **pas** implémentée.
- Un `click` est un **clic conseillé**, jamais un clic observé : CoachGG ne connaît pas les commandes du joueur.
- Une `alternative` est une **proposition**, pas une simulation : aucune issue n'est garantie.

## Moment de coaching (`Recommendation`)

| Bloc | Champ(s) |
|---|---|
| Fenêtre | `contextStartMs` ≤ `slowdownStartMs` ≤ `decisionMs` < `endMs` (≥ 2 s de contexte avant la décision), `slowdownRate`. |
| 1. Observations | `Observation[]` — uniquement ce qui est visible ou établi. |
| 2. Interprétation | `interpretation` — avec les informations disponibles **au moment de décider**. |
| 3. Alternatives | `[{ label, conditions, limits }]` — au moins une pour une « décision à revoir », sauf confiance `INCONCLUSIVE`. |
| 4. Confiance | `HIGH` · `MEDIUM` · `LOW` · `INCONCLUSIVE` (« le contexte ne permet pas de conclure ») + `confidenceReason`. |
| 5. Conseil | `advice` court et réutilisable. |
| 6. Références | vidéo, horodatages, temps de jeu (si synchronisé), `analysisVersion`, provenance. |

Types : décision à revoir, bonne action, objectif, engagement, occasion manquée, situation intéressante — une mort n'est pas automatiquement une erreur.

## Parcours du lecteur

Lecture → ralenti (`slowdownStartMs`) → pause exacte à `decisionMs` → éléments mis en évidence → trajectoire réelle → alternative animée pendant la pause → explication structurée → « Revoir » (retour au contexte) ou « Continuer ».
