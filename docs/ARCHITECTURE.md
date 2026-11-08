# Architecture

## Vue d'ensemble

```
Navigateur ──HTTP──▶ Next.js 15 (App Router, TypeScript)
                       ├─ pages (Server Components) + composants client
                       ├─ route handlers /api/*  (auth, contrôle d'accès, validation zod)
                       └─ Prisma ──▶ PostgreSQL ◀── Worker Node (tsx)
                                        ▲             ├─ file de tâches (SKIP LOCKED)
                                        │             ├─ FFmpeg / ffprobe (processus isolés)
                       stockage privé ◀─┴─────────────┘  └─ purge de conservation
                       (disque local, interface StorageDriver → S3 possible)
Application PC (phase 5) ──▶ même API d'envoi par morceaux
```

Choix : **une seule base d'infra** (PostgreSQL) — la file de tâches y vit aussi. Pas de Redis, pas de GPU, pas de modèle entraîné tant qu'aucun besoin n'est démontré. Python/OpenCV interviendront en phase 4 comme worker séparé consommant la même file.

## Découpage du code

| Dossier | Rôle |
|---|---|
| `src/lib/annotations/` | **Pur, partagé client/serveur** : schéma zod des annotations et moments, géométrie (rectangle de contenu, projection, minimap), logique du parcours pédagogique. |
| `src/lib/scoring/` | **Pur** : configuration versionnée, moteur de note, MVP, recommandations statistiques. |
| `src/server/auth/` | Mots de passe (scrypt), sessions (jeton haché en base), inscription/connexion/récupération. |
| `src/server/permissions.ts` | **Source unique** du contrôle d'accès (vidéos, groupes, matchs). |
| `src/server/video/` | Formats, envoi par morceaux, FFmpeg, traitement, moments/annotations. |
| `src/server/jobs.ts` | File de tâches persistante, idempotente, avec backoff et annulation. |
| `src/server/matches/`, `scores.ts` | Saisie de matchs, historique, persistance des notes et rapports de groupe. |
| `src/server/riot/` | Intégration Riot isolée (client, conversion, import). |
| `src/server/teams/` | Groupes, invitations, tableau de bord, rapport collectif. |
| `src/worker/` | Processus worker. |
| `src/app/` | Pages et routes API. |
| `src/components/` | Interface (lecteur de coaching dans `components/video/`). |

## Modèle de données (Prisma)

Comptes : `User`, `Session`, `PasswordResetToken`, `PlayerProfile`, `GameIdentity`.
Matchs : `Match` (source MANUAL / RIOT_API / DEMO, `isDemo`), `MatchParticipant` (lien optionnel vers un compte), `MatchStatistics` (champs optionnels : `null` = non disponible).
Vidéo : `Recording` (statut, clés de stockage, métadonnées, synchronisation `gameStartOffsetMs`, zone minimap), `Clip`.
Analyses : `AnalysisJob` (statut, essais, verrou, progression, durée, coût), `Recommendation` (moment de coaching), `Observation`, `VideoAnnotation`, `AnalysisFeedback`.
Scores : `ScoreVersion` (configuration figée), `PerformanceScore` (unique par participant et version), `TeamMatchReport` (présents, MVP, égalité, distinctions).
Social : `Team`, `TeamMembership`, `TeamInvitation`, `SharePermission`, `Goal`, `Notification`.

Chaque analyse conserve source, version (`analysisVersion`), statut, horodatages, observations, provenance (`MANUAL`/`AUTOMATIC`).

## Pipeline vidéo

1. `POST /api/recordings` — validation (extension, MIME, taille, quotas) → `Recording(UPLOADING)`.
2. `PUT /api/recordings/:id/upload` avec `Upload-Offset` — morceaux ≤ 8 Mo, signature binaire vérifiée au 1er morceau, réalignement si écriture interrompue, conflit 409 avec la position réelle.
3. Dernier morceau → `UPLOADED` + tâche `PROCESS_RECORDING` (clé d'idempotence `process:<id>`).
4. Worker : `ffprobe` (piste vidéo, durée, résolution) → remux `+faststart` si H.264/AAC, sinon transcodage H.264 ≤ 1080p (threads et durée limités) → miniature → `READY` + notification. Fichiers temporaires supprimés dans tous les cas.
5. Erreur de contenu (corrompu, trop long) = **échec définitif** ; erreur temporaire = nouvelle tentative avec backoff (3 essais). Annulation : `cancelRequested` → FFmpeg tué.
6. Lecture : `GET /api/recordings/:id/stream` (requêtes Range, session + permission à chaque requête).

Étapes futures (phase 4) dans la même file : association au match, synchronisation automatique, sélection de séquences, extraction d'images, observations, diagnostic avec confiance, annotations `AUTOMATIC`, statut `NEEDS_REVIEW`.

## Lecteur de coaching

- Overlay **SVG** au-dessus de la `<video>`, positionné sur le **rectangle réel** de l'image (`contentRect`, gère les bandes noires).
- Toute animation est une **fonction pure du temps vidéo** → correcte après seek/pause, sans dérive.
- Boucle `requestAnimationFrame` : lecture de `currentTime`, vitesse ralentie dans la fenêtre, pause au franchissement de la décision (un seek ne déclenche jamais la pause).
- Pendant la pause : horloge locale pour animer l'**alternative** (la trajectoire réelle reste affichée).
- `ResizeObserver` + plein écran sur le conteneur (vidéo + panneau).

## Sécurité

- Sessions : jeton aléatoire 256 bits, seul son SHA-256 est stocké ; cookie `httpOnly`, `SameSite=Lax`, `Secure` en production.
- CSRF : vérification de l'en-tête `Origin` sur les requêtes mutantes.
- Contrôle d'accès serveur systématique ; une ressource non visible renvoie 404.
- Vidéos privées : l'appartenance à un groupe ne donne **jamais** accès ; partage explicite révocable ; départ du groupe = révocation de ses partages et perte d'accès immédiate.
- Fichiers jamais servis statiquement ; clés de stockage validées (pas de traversée de chemin).
- FFmpeg sans shell, délai maximal, threads limités, processus séparé du serveur web.
- Quotas : 3 envois simultanés, 30/jour, espace total ; limites de débit (en mémoire, instance unique).
- Logs sans données sensibles (messages d'erreur uniquement).
- Secrets uniquement via variables d'environnement (`.env` ignoré par git).

Limites connues : limiteur de débit en mémoire (à partager en multi-instance) ; isolation FFmpeg au niveau processus (conteneur/sandbox dédié recommandé en production) ; pas d'antivirus sur les fichiers.
