# Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 1 | Socle, auth, import vidéo réel → stockage → lecteur → annotations horodatées → explication sauvegardée | ✅ Livré (annotations manuelles) |
| 2 | Statistiques, historique, rapports, note transparente | ✅ Livré (saisie manuelle ; Riot si clé) — note expérimentale |
| 3 | Groupes, invitations, matchs communs, notes, MVP | ✅ Livré |
| 4 | Analyse vidéo assistée (catégories limitées, observations, confiance) | 🧪 Livré en expérimental (`auto-0.1.0`, revue humaine obligatoire) |
| 5 | Application PC, capture, découpage, automatisation après match | ⏳ Conception ([DESKTOP.md](DESKTOP.md)) |
| 6 | Progression, objectifs, coach conversationnel, débrief collectif | 🟡 Partiel : objectifs individuels/collectifs + bilan, rapport collectif déterministe. Coach conversationnel à faire. |

## Prochaines étapes proposées
1. **Phase 4 — suite** : mesurer la précision sur de vraies parties (jeu de vidéos annotées, avec consentement) ; détection automatique de la zone minimap ; distinguer combat / mouvement de caméra ; croiser avec la timeline MATCH-V5 (morts horodatées) quand une clé Riot est disponible.
2. Clips : bibliothèque de clips (favoris, notes personnelles) à partir des moments ; export vidéo annoté (rendu FFmpeg de l'overlay).
3. Import Riot : timeline MATCH-V5 (évolution or/CS, objectifs horodatés) pour la synchronisation vidéo ↔ événements ; LEAGUE-V4 pour le rang.
4. Coach conversationnel : réponses à partir des données autorisées (mêmes contrôles d'accès), citations de matchs/clips/horodatages, « information manquante » explicite.
5. Email (récupération, invitations hors compte), stockage S3 privé, limiteur partagé.
6. Recalibrage de la note sur données réelles avec source et taille d'échantillon.
