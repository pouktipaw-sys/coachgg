# Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 1 | Socle, auth, import vidéo réel → stockage → lecteur → annotations horodatées → explication sauvegardée | ✅ Livré (annotations manuelles) |
| 2 | Statistiques, historique, rapports, note transparente | ✅ Livré (saisie manuelle ; Riot si clé) — note expérimentale |
| 3 | Groupes, invitations, matchs communs, notes, MVP | ✅ Livré |
| 4 | Analyse vidéo assistée (catégories limitées, observations, confiance) | 🧪 Livré en expérimental (`auto-0.1.0`, revue humaine obligatoire) |
| 5 | Application PC, capture, découpage, automatisation après match | 🧪 Agent expérimental livré ; capture Windows à valider sur un vrai PC, installeur à faire ([DESKTOP.md](DESKTOP.md)) |
| 6 | Progression, objectifs, coach conversationnel, débrief collectif | ✅ Livré : progression, bilans hebdomadaires, coach sourcé (mode sans IA ; mode IA si clé, non exécuté ici contre l'API réelle) ([COACH.md](COACH.md)) |

## Livré depuis
- Clips : bibliothèque (favoris, catégories, notes personnelles) et export MP4 annoté.
- Visionnage synchronisé multi-vidéos d'un même match.
- Riot : timeline MATCH-V5 (or/CS par minute, achats) et rang LEAGUE-V4 (si clé).
- Emails : SMTP (`SMTP_URL`), invitations par email aux personnes sans compte.

## Prochaines étapes proposées
1. **Phase 4 — suite** : outils de mesure livrés (vérité terrain manuelle/Riot, évaluation, banc d'essai). Reste à **constituer un jeu de ≥ 20 vraies parties étiquetées** et publier les chiffres ; détection automatique de la zone minimap ; distinguer combat / mouvement de caméra ; croiser avec la timeline MATCH-V5 (morts horodatées) quand une clé Riot est disponible.
2. **Phase 5 — suite** : dérouler la liste de vérification Windows de DESKTOP.md, puis exécutable unique + installeur signé + démarrage automatique.
3. Import Riot : valider avec une vraie clé (timeline et rang sont livrés, testés uniquement contre un serveur simulé) ; demander une clé de production ; Riot Sign On pour vérifier les identités.
4. Coach : valider le mode IA avec une vraie clé (qualité, coût réel, taux de cache), puis construire un jeu d'évaluation de questions/réponses attendues.
5. Stockage S3 privé (driver `StorageDriver`), limiteur de débit partagé entre instances.
6. Recalibrage de la note sur données réelles avec source et taille d'échantillon.
