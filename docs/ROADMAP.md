# Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 1 | Socle, auth, import vidéo réel → stockage → lecteur → annotations horodatées → explication sauvegardée | ✅ Livré (annotations manuelles) |
| 2 | Statistiques, historique, rapports, note transparente | ✅ Livré (saisie manuelle ; Riot si clé) — note expérimentale |
| 3 | Groupes, invitations, matchs communs, notes, MVP | ✅ Livré |
| 4 | Analyse vidéo assistée (catégories limitées, observations, confiance) | 🧪 Livré en expérimental (`auto-0.1.0`, revue humaine obligatoire) |
| 5 | Application PC, capture, découpage, automatisation après match | 🧪 Agent expérimental livré ; capture Windows à valider sur un vrai PC, installeur à faire ([DESKTOP.md](DESKTOP.md)) |
| 6 | Progression, objectifs, coach conversationnel, débrief collectif | ✅ Livré : progression, bilans hebdomadaires, coach sourcé (mode sans IA ; mode IA si clé, non exécuté ici contre l'API réelle) ([COACH.md](COACH.md)) |

## Prochaines étapes proposées
1. **Phase 4 — suite** : outils de mesure livrés (vérité terrain manuelle/Riot, évaluation, banc d'essai). Reste à **constituer un jeu de ≥ 20 vraies parties étiquetées** et publier les chiffres ; détection automatique de la zone minimap ; distinguer combat / mouvement de caméra ; croiser avec la timeline MATCH-V5 (morts horodatées) quand une clé Riot est disponible.
2. **Phase 5 — suite** : dérouler la liste de vérification Windows de DESKTOP.md, puis exécutable unique + installeur signé + démarrage automatique.
3. Clips : bibliothèque de clips (favoris, notes personnelles) à partir des moments ; export vidéo annoté (rendu FFmpeg de l'overlay).
4. Import Riot : timeline MATCH-V5 (évolution or/CS, objectifs horodatés) pour la synchronisation vidéo ↔ événements ; LEAGUE-V4 pour le rang.
5. Coach : valider le mode IA avec une vraie clé (qualité, coût réel, taux de cache), puis construire un jeu d'évaluation de questions/réponses attendues.
6. Email (récupération, invitations hors compte), stockage S3 privé, limiteur partagé.
7. Recalibrage de la note sur données réelles avec source et taille d'échantillon.
