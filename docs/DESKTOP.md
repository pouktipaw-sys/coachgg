# Application PC de capture (phase 5) — agent `0.1.0`, expérimental

## État
| Élément | État |
|---|---|
| Appairage par code, jeton d'appareil révocable, état de capture dans le site | ✅ Testé (intégration + E2E) |
| Détection de partie, synchronisation automatique, événements de partie | ✅ Testé avec un client simulé |
| Enregistrement FFmpeg, MP4 fragmenté (lisible après plantage), limite disque | ✅ Testé sous Linux avec la source `testsrc` |
| Découpage après match, file d'envoi reprenable, reprise après interruption | ✅ Testé |
| Interface locale (configuration, appairage, test d'enregistrement) | ✅ Testé |
| **Capture réelle de la fenêtre du jeu sous Windows (`gdigrab`)** | ⚠️ **Écrite, non testée** (environnement de développement Linux) |
| Installeur Windows signé, démarrage automatique, icône de zone de notification | ⏳ Non fait |

## Choix technique
Un **agent Node.js/TypeScript** pilote **FFmpeg** (un seul moteur pour la capture, l'encodage et le découpage) :
- même langage que le site (code partagé, une seule équipe), cœur testable sur n'importe quel OS ;
- capture `gdigrab` de la **fenêtre** dont le titre est « League of Legends (TM) Client » — rien d'autre n'est capturé ;
- encodeur logiciel (libx264) par défaut, encodeurs matériels NVENC/AMF/QSV sélectionnables.

Si les performances ou la compatibilité de `gdigrab` s'avèrent insuffisantes sur de vrais PC, le module `recorder.ts` est le seul à remplacer (par ex. API Windows.Graphics.Capture via un petit binaire natif) ; le reste de l'agent ne change pas.

## Parcours
1. Sur le site : **Capture PC → Générer un code** (8 caractères, 10 min, usage unique).
2. Sur le PC : `npm run agent -- start`, ouvrir l'adresse affichée (`http://127.0.0.1:47800/?t=…`), saisir le code. Ou `npm run agent -- pair CODE --server https://…`.
3. **Tester l'enregistrement** (4 s) : détecte une fenêtre introuvable ou une image noire (mode plein écran exclusif) et conseille le mode « Fenêtré sans bordure ».
4. Pendant une partie : l'agent enregistre. À la fin : finalisation, découpage éventuel, mise en file, envoi par morceaux, suppression locale.
5. Sur le site : la vidéo apparaît, **synchronisée** avec l'horloge du jeu ; l'analyse assistée s'enchaîne ; les morts enregistrées servent de vérité terrain pour mesurer sa précision.

## Détection de partie et événements
API locale du client (`https://127.0.0.1:2999/liveclientdata/…`), **lecture seule**, certificat auto-signé accepté uniquement pour 127.0.0.1 :
- `gamestats` → partie en cours + horloge de jeu (synchronisation : `gameStartOffsetMs = −horloge au démarrage`) ;
- `eventdata` → événements (morts, éliminations, objectifs) mémorisés pendant la partie, exploités **après** ;
- `activeplayername` → identifier les événements du joueur.
Fin de partie : événement `GameEnd`, ou API muette pendant 3 sondages.

Rien n'est affiché ni conseillé pendant la partie. Aucune lecture mémoire, aucune injection, aucune interaction avec Vanguard.

## Fiabilité
- **Plantage pendant l'enregistrement** : MP4 fragmenté + fichier témoin → la vidéo partielle est récupérée et envoyée au redémarrage (« enregistrement interrompu »).
- **Coupure réseau** : file persistante (`queue.json`), backoff jusqu'à 15 min, reprise à l'octet près, clé d'idempotence `clientUploadId` (pas de doublon serveur).
- **Disque** : enregistrement refusé si moins d'1 Go disponible dans la limite (20 Go par défaut) ; FFmpeg plafonné (`-fs`) ; seuls les fichiers déjà envoyés sont supprimés automatiquement.
- **Erreur définitive** (quota, jeton révoqué) : marquée « échec », jamais supprimée localement, relançable depuis l'interface.

## Sécurité
- Jeton d'appareil (`cgd_…`) haché en base, limité à : créer/envoyer une vidéo, envoyer les événements de ses vidéos, signaler son état. Révocation immédiate depuis le site.
- Configuration locale en `0600`. L'interface locale écoute sur 127.0.0.1, vérifie l'en-tête `Host` (anti-rebinding) et exige un jeton aléatoire par lancement.

## Liste de vérification sur un vrai PC Windows (à faire avant de quitter l'expérimental)
1. `npm run agent -- test` en partie d'entraînement : mode fenêtré sans bordure, puis plein écran → noter le résultat.
2. Partie complète : fichier lisible, durée correcte, sans saccades ; utilisation processeur/GPU avec libx264 puis NVENC/AMF.
3. Décalage de synchronisation : comparer l'horloge du jeu visible dans la vidéo et le temps de jeu affiché dans le lecteur (objectif : < 1 s).
4. Noms renvoyés par `activeplayername` et `VictimName` (avec ou sans `#TAG`) : vérifier que les morts du joueur sont bien reconnues.
5. Tuer l'agent en pleine partie, relancer → vidéo récupérée.
6. Couper le réseau pendant l'envoi → reprise.
7. Vérifier l'absence de toute alerte de l'anti-triche.

## Packaging (à faire)
Exécutable unique (Node SEA ou `pkg`) + `ffmpeg.exe` (build LGPL), installeur signé (MSIX ou Inno Setup), démarrage avec Windows, icône de zone de notification. Licence FFmpeg : utiliser une build LGPL et fournir les sources/notice correspondantes ; libx264 est GPL — en cas de distribution d'une build GPL, l'agent doit respecter la GPL, sinon privilégier les encodeurs matériels.

## Sélection des champions (runes, objets, conseils)

Pendant la **sélection des champions uniquement**, l'agent lit la session via l'API locale officielle du client
(fichier `lockfile` du client, `desktop/src/lcu.ts`) :

- **conseils** affichés dans l'interface locale : contres de l'adversaire de voie, meilleurs choix du rôle, bannissements
  (`/api/meta/draft`, statistiques méta du serveur) ;
- quand **ton** champion est verrouillé : création d'une page de runes « CoachGG » (remplace la précédente page CoachGG,
  sinon la page active si elle est modifiable) et d'un ensemble d'objets pour ce champion (`/api/meta/build`).
  Une seule fois par sélection ; désactivable : `champSelect.importRunes` / `champSelect.importItems` dans `config.json`.

Jamais : choix ou verrouillage automatique, action en partie, lecture mémoire, affichage par-dessus le jeu.
Client installé ailleurs que `C:\Riot Games\League of Legends` : `LEAGUE_DIR` ou `champSelect.lockfile`.

## Lancement avec Windows

```bash
npm run agent -- autostart on
```

Ajoute un raccourci dans le dossier « Démarrage » de l'utilisateur (sans droits administrateur) : l'agent démarre
réduit à l'ouverture de session et attend le client et les parties. `npm run agent -- autostart off` pour l'enlever.
Ce n'est pas encore un installateur `.exe` : Node.js et le dossier du projet restent nécessaires.

## Sorts d'invocateur, acceptation automatique, compagnon de partie

- **Sorts d'invocateur** conseillés réglés au verrouillage (`champSelect.importSpells`, activé) ; Saut éclair reste
  sur la touche où tu l'avais (D ou F).
- **Acceptation automatique** de la partie trouvée (`champSelect.autoAccept`) : **désactivée par défaut**, à activer
  soi-même dans `config.json`. Vérifie qu'elle est toujours permise par les règles de Riot pour les applications tierces.
- **Compagnon de partie** : pendant la partie, l'interface locale affiche **tes** statistiques en direct (sbires par
  minute, sbires, KDA, or, niveau) via l'API locale du jeu en lecture seule. Rien sur les ennemis, rien par-dessus le
  jeu : à ouvrir sur un 2e écran ou un téléphone (même réseau).
- **Jamais** : bannissement, choix ou verrouillage automatiques.
