# Application PC de capture (phase 5) — conception

**État : non développée.** Ce document fixe les contraintes à valider avant d'écrire du code.

## Principes non négociables
- Capture **après coup uniquement** : aucun conseil pendant la partie, aucune superposition en jeu.
- **Aucune lecture mémoire**, aucune injection, aucun hook dans le processus du jeu, aucune interaction avec Vanguard.
- Capture de la **fenêtre du jeu uniquement** par défaut ; microphone et webcam désactivés ; vidéos privées.

## Pistes techniques à vérifier
| Besoin | Piste | À valider |
|---|---|---|
| Capture | API Windows.Graphics.Capture (capture de fenêtre), encodage matériel (Media Foundation / NVENC / AMF / QSV) ou intégration de libobs (OBS, GPL-2.0 — impact licence) | Compatibilité avec le mode d'affichage du jeu, absence de conflit avec l'anti-triche, licence. |
| Détection début/fin de partie | Présence du processus/fenêtre de jeu ; API officiellement documentées du client (Live Client Data API locale, port 2999, lecture seule pendant la partie) | Conditions d'utilisation Riot : l'usage doit rester limité à la détection d'état, sans conseil en direct. |
| Technologie | Application native (C#/.NET ou Rust) pour la capture ; interface légère (Tauri ou WinUI) | Taille, signature de code, mises à jour. |
| Envoi | Même protocole que l'import web (`POST /api/recordings` puis `PUT …/upload` par morceaux, reprenable) avec un **jeton d'appareil** dédié (à créer) | Révocation des jetons, quotas. |

## Fonctionnalités cibles
Installation unique · configuration et test d'enregistrement · statut de capture · stockage temporaire avec limite disque · découpage après match (FFmpeg) · envoi des clips · nettoyage automatique · reprise après interruption.

## Pourquoi pas le site web
Un navigateur ne peut pas enregistrer un jeu en arrière-plan : `getDisplayMedia` exige une action explicite à chaque session et un onglet ouvert. Ce n'est pas un enregistrement automatique fiable.
