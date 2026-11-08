# CoachGG AI

Coaching **League of Legends après match** : statistiques expliquées, vidéo avec corrections animées, groupes d'amis avec notes et MVP.

> Joue ta partie. CoachGG analyse tes statistiques et ta vidéo, explique tes décisions, te montre des alternatives et t'aide à progresser seul ou avec tes amis.

CoachGG n'est ni approuvé ni sponsorisé par Riot Games. Aucun conseil pendant la partie, aucune lecture mémoire, aucun contournement de Vanguard.

---

## État des fonctionnalités (honnête)

| Domaine | État | Détail |
|---|---|---|
| Comptes (inscription, connexion, déconnexion, récupération) | ✅ Opérationnel | Sessions en base, scrypt. Récupération : lien écrit dans les logs serveur **en dev uniquement** (email non configuré). |
| Profil, préférences, confidentialité, export, suppression | ✅ Opérationnel | Export JSON, suppression définitive (fichiers + données). |
| Identité Riot | 🧪 Déclarée | Riot ID saisi par l'utilisateur, **non vérifié** (Riot Sign On non disponible). Jamais de mot de passe Riot. |
| **Import vidéo** | ✅ Opérationnel | Envoi par morceaux, progression, reprise après coupure ou rechargement, annulation, validation extension + signature + ffprobe, quotas. |
| **Traitement vidéo** | ✅ Opérationnel | Worker FFmpeg : remux H.264 ou transcodage, miniature, nouvelles tentatives, annulation, idempotence, suivi du temps. |
| **Lecteur de coaching + corrections animées** | ✅ Opérationnel (annotations **manuelles**) | Ralenti, pause à la décision, trajectoire réelle/alternative animées, zones, alliés/ennemis, clic conseillé, minimap, plein écran, raccourcis. |
| Moments de coaching (Observations / Interprétation / Alternatives / Confiance / Conseil / Références) | ✅ Opérationnel (saisie manuelle) | Signalement d'un diagnostic incorrect. |
| Statistiques, historique, filtres, rapport de match | ✅ Opérationnel | Saisie manuelle ; import Riot si clé configurée. |
| Note CoachGG expliquée | 🧪 Expérimentale | Formule `perf-1.0.0` déterministe, versionnée, testée. Repères = heuristiques internes (pas d'échantillon). |
| Import Riot (MATCH-V5) | ⚙️ Non configuré par défaut | Nécessite `RIOT_API_KEY`. Testé avec un serveur simulé. |
| Groupes, invitations, rôles, matchs communs, MVP, distinctions, rapport collectif | ✅ Opérationnel | |
| Objectifs individuels et collectifs | ✅ Opérationnel | Bilan mesuré sur les notes réelles de la période. |
| Notifications internes | ✅ Opérationnel | Vidéo prête/échec, invitations. |
| Administration minimale | ✅ Opérationnel | Tâches, relance, signalements. |
| Analyse vidéo automatique | ⏳ Non disponible | Phase 4. |
| Application PC (capture) | ⏳ Non disponible | Phase 5 — conception dans [docs/DESKTOP.md](docs/DESKTOP.md). |
| Coach conversationnel | ⏳ Non disponible | Phase 6. |
| Export vidéo annotée, visionnage synchronisé multi-vidéos | ⏳ Non disponible | |
| Rang (LEAGUE-V4) | ⏳ Non intégré | Affiché « non disponible ». |

Voir [docs/ROADMAP.md](docs/ROADMAP.md) pour l'avancement par phase.

---

## Démarrage rapide

Prérequis : **Node.js ≥ 20**, **PostgreSQL ≥ 14**, **FFmpeg** (avec `ffprobe`) dans le `PATH`.

```bash
npm install
```

```bash
cp .env.example .env   # puis ajustez DATABASE_URL
```

```bash
npx prisma migrate deploy
```

```bash
npm run dev:all        # serveur web (port 3000) + worker vidéo
```

Ouvrez http://localhost:3000, créez un compte, importez une vidéo (`/app/videos/upload`).

Le **worker** est indispensable au traitement des vidéos. Séparément : `npm run dev` et `npm run worker`.

Pour obtenir une vidéo de test sans enregistrer de partie :

```bash
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -t 20 -c:v libx264 -pix_fmt yuv420p test.mp4
```

Administrateur : `npm run admin:promote -- email@exemple.fr`.

## Tests

| Commande | Contenu |
|---|---|
| `npm run test:unit` | Logique pure : schéma d'annotations, géométrie (letterbox, redimensionnement), parcours pédagogique, formats, notation, MVP. |
| `npm run test:integration` | PostgreSQL + **FFmpeg réels** : pipeline vidéo (MP4, WEBM, corrompu, reprise d'envoi), file de tâches, permissions (utilisateurs, groupes, retrait de partage, départ), auth, matchs, MVP, égalité, Riot simulé, export/suppression. Base `coachgg_test` (doit contenir « test »). |
| `npm run test:e2e` | Playwright, serveur + worker réels, base `coachgg_e2e` : import réel → moment → annotation → ralenti → pause → seek → redimensionnement → plein écran → persistance ; fichier invalide ; groupe → invitation → match commun → MVP. |

```bash
createdb coachgg_test && createdb coachgg_e2e
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — découpage, modèle de données, pipeline, sécurité.
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — variables d'environnement, intégrations externes, déploiement.
- [docs/ANNOTATIONS.md](docs/ANNOTATIONS.md) — format des annotations et des moments de coaching.
- [docs/SCORING.md](docs/SCORING.md) — note CoachGG, MVP, limites.
- [docs/DESKTOP.md](docs/DESKTOP.md) — application PC de capture (conception, contraintes).
- [docs/LEGAL.md](docs/LEGAL.md) — points juridiques et autorisations à faire valider.
- [docs/ROADMAP.md](docs/ROADMAP.md) — phases et prochaines étapes.
