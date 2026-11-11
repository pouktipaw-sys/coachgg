# CoachGG AI

Coaching **League of Legends après match** : statistiques expliquées, vidéo avec corrections animées, groupes d'amis avec notes et MVP.

> Joue ta partie. CoachGG analyse tes statistiques et ta vidéo, explique tes décisions, te montre des alternatives et t'aide à progresser seul ou avec tes amis.

CoachGG n'est ni approuvé ni sponsorisé par Riot Games. Aucun conseil pendant la partie, aucune lecture mémoire, aucun contournement de Vanguard.

---

## État des fonctionnalités (honnête)

| Domaine | État | Détail |
|---|---|---|
| Comptes (inscription, connexion, déconnexion, récupération) | ✅ Opérationnel | Sessions en base, scrypt. Emails via SMTP si `SMTP_URL` est défini ; sinon lien écrit dans les logs serveur **en dev uniquement**. |
| Profil, préférences, confidentialité, export, suppression | ✅ Opérationnel | Export JSON, suppression définitive (fichiers + données). |
| Identité Riot | 🧪 Déclarée | Riot ID saisi par l'utilisateur, **non vérifié** (Riot Sign On non disponible). Jamais de mot de passe Riot. |
| **Import vidéo** | ✅ Opérationnel | Envoi par morceaux, progression, reprise après coupure ou rechargement, annulation, validation extension + signature + ffprobe, quotas. |
| **Traitement vidéo** | ✅ Opérationnel | Worker FFmpeg : remux H.264 ou transcodage, miniature, nouvelles tentatives, annulation, idempotence, suivi du temps. |
| **Lecteur de coaching + corrections animées** | ✅ Opérationnel (annotations **manuelles**) | Ralenti, pause à la décision, trajectoire réelle/alternative animées, zones, alliés/ennemis, clic conseillé, minimap, plein écran, raccourcis. |
| Moments de coaching (Observations / Interprétation / Alternatives / Confiance / Conseil / Références) | ✅ Opérationnel (saisie manuelle) | Signalement d'un diagnostic incorrect. |
| Statistiques, historique, filtres, rapport de match | ✅ Opérationnel | Saisie manuelle ; import Riot si clé configurée. |
| Note CoachGG expliquée | 🧪 Expérimentale | Formule `perf-1.0.0` déterministe, versionnée, testée. Repères = heuristiques internes (pas d'échantillon). |
| Import Riot (MATCH-V5 + timeline) | ⚙️ Non configuré par défaut | Nécessite `RIOT_API_KEY`. **Tout l'historique** importé en tâche de fond dès l'ajout du Riot ID (jusqu'à `RIOT_HISTORY_MAX` parties), puis mis à jour à chaque visite. Évolution or/CS minute par minute, achats. Testé avec un serveur simulé (aucune clé réelle ici). |
| Communauté | ✅ Opérationnel | Reels (fil vertical, lecture automatique) : seul le clip exporté est diffusé, jamais la vidéo complète, et uniquement des clips de ses propres vidéos. Forum : exploits, demandes de conseils, discussions ; j'aime, commentaires, signalements, modération par l'administration. |
| Progression avancée | ✅ Opérationnel | « Porteur ou porté » (ta note comparée à celle de tes coéquipiers), profil de joueur en toile (avant / maintenant), page « Rang suivant » : priorités par écart à des repères **estimés** par rang, conseils de jeu et gestes souris/clavier, exemples vidéo tirés de tes moments publiés et de ceux partagés. |
| Comptes Riot multiples | ✅ Opérationnel | Plusieurs comptes par utilisateur, synchronisés séparément, compte principal au choix, filtre par compte. |
| Amis (« Ta squad ») | ✅ Opérationnel | Demandes d'ami par Riot ID (réponse identique avec ou sans compte), cartes d'ami : rang, forme des 5 dernières parties, séries, badges calculés sur les vraies parties (En feu, Élu MVP, Œil de lynx, Fermier d'élite, Intouchable, Régulier, Assidu), classement de la semaine avec podium. Accepter = partager ce résumé, jamais les vidéos. |
| Coéquipiers et vote du MVP | ✅ Opérationnel | Coéquipiers suivis par Riot ID (compte CoachGG facultatif) : parties ensemble, taux de victoire, notes reçues. Après chaque partie, chaque joueur note ses coéquipiers /10, élit le MVP et attribue des catégories (Carry, Teamfight, Vision, Shotcaller, Action décisive, Soutien). |
| Groupes, invitations, rôles, matchs communs, MVP, distinctions, rapport collectif | ✅ Opérationnel | Invitation par email d'une personne sans compte : lien d'inscription à usage unique (envoi réel si SMTP configuré). |
| Objectifs individuels et collectifs | ✅ Opérationnel | Bilan mesuré sur les notes réelles de la période. |
| Notifications internes | ✅ Opérationnel | Vidéo prête/échec, invitations. |
| Administration minimale | ✅ Opérationnel | Tâches, relance, signalements. |
| Analyse vidéo assistée | 🧪 Expérimentale | Installation : `npm run setup:analysis`. **Avec `ANTHROPIC_API_KEY`** : Claude examine 6 images avant chaque mort détectée et produit observations, alternative, conseil et schéma (trajet réel, trajet conseillé, zone dangereuse, ennemis) — propositions marquées « IA, à vérifier » ; jamais testé ici contre l'API réelle. **Fin d'analyse** : bilan écrit (3 priorités, objectif) et **vidéo récap** MP4 (intro, chaque moment avec ralenti, pause, schéma et conseil, bilan). Découpe automatiquement chaque mort détectée en clip (et les combats probables en option). Python/OpenCV : écran grisé (mort probable), forte activité, marqueurs rouges minimap avant l'événement → propositions **en brouillon à valider**. Précision mesurable (vérité terrain manuelle ou timeline Riot, banc d'essai). Voir [docs/ANALYSIS.md](docs/ANALYSIS.md). |
| Application PC (capture) | 🧪 Expérimentale | Agent `npm run agent -- start` : appairage par code, détection de partie, enregistrement de la fenêtre du jeu (FFmpeg), synchronisation automatique, découpage, envoi reprenable. Cœur testé sous Linux ; **capture Windows non encore testée sur un vrai PC**. Voir [docs/DESKTOP.md](docs/DESKTOP.md). |
| Coach conversationnel | ✅ Mode sans IA · 🧪 mode IA si clé | Réponses sourcées (matchs, clips à l'horodatage, objectifs, groupes), information manquante explicite, signalement. Mode IA : Claude (`claude-opus-5-5`) avec `ANTHROPIC_API_KEY`, citations vérifiées, repli automatique. Voir [docs/COACH.md](docs/COACH.md). |
| Progression et bilans | ✅ Opérationnel | Forces, difficultés, tendances, par rôle/champion, objectifs accomplis ; bilan hebdomadaire notifié. |
| Clips et export vidéo annotée | ✅ Opérationnel | Bibliothèque (favoris, catégories, notes), export MP4 avec corrections incrustées (Pillow + FFmpeg, worker) : ralenti, pause à la décision, alternative, explication. Les brouillons automatiques ne sont jamais incrustés. |
| Visionnage synchronisé multi-vidéos | ✅ Opérationnel | Vidéos d'un même match sur une horloge de jeu commune (lecture, déplacement, vitesse, son, moments). Uniquement les vidéos déjà visibles par l'utilisateur. |
| Rang (LEAGUE-V4) | ⚙️ Si clé Riot | Bouton « Actualiser le rang » dans les paramètres ; testé avec un serveur simulé. |

Voir [docs/ROADMAP.md](docs/ROADMAP.md) pour l'avancement par phase.

---

## Démarrage rapide

Prérequis : **Node.js ≥ 22.12**, **PostgreSQL ≥ 14**, **FFmpeg** (avec `ffprobe`) dans le `PATH`, **Python ≥ 3.10** pour l'analyse assistée (facultatif).

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
python3 -m venv .venv-analysis && .venv-analysis/bin/pip install -r analysis/requirements.txt   # analyse assistée (facultatif)
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

Vidéo de démonstration (serveur et worker lancés ; vidéo de partie au choix) :

```bash
npm run demo:video -- http://localhost:3000 partie.mp4 ./demo-out
```

Agent PC (enregistrement automatique, voir [docs/DESKTOP.md](docs/DESKTOP.md)) :

```bash
npm run agent -- start
```

## Tests

| Commande | Contenu |
|---|---|
| `npm run test:unit` | Logique pure : schéma d'annotations, géométrie (letterbox, redimensionnement), parcours pédagogique, formats, notation, MVP. |
| `npm run test:integration` | PostgreSQL + **FFmpeg réels** : pipeline vidéo (MP4, WEBM, corrompu, reprise d'envoi), file de tâches, permissions (utilisateurs, groupes, retrait de partage, départ), auth, matchs, MVP, égalité, Riot simulé, export/suppression. Base `coachgg_test` (doit contenir « test »). |
| `npm run test:analysis` | Tests Python de l'analyseur (fonctions de détection). |
| `npm run benchmark:analysis -- <dossier>` | Banc d'essai hors ligne sur des vidéos étiquetées (`labels.json`) : précision, rappel, décalage. |
| `npm run test:e2e` | Playwright, serveur + worker réels, base `coachgg_e2e` : import réel → moment → annotation → ralenti → pause → seek → redimensionnement → plein écran → persistance ; fichier invalide ; groupe → invitation → match commun → MVP. |

```bash
createdb coachgg_test && createdb coachgg_e2e
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — découpage, modèle de données, pipeline, sécurité.
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — variables d'environnement, intégrations externes, déploiement.
- [docs/ANNOTATIONS.md](docs/ANNOTATIONS.md) — format des annotations et des moments de coaching.
- [docs/ANALYSIS.md](docs/ANALYSIS.md) — analyse vidéo assistée : pipeline, signaux, règles, revue, limites.
- [docs/COACH.md](docs/COACH.md) — coach conversationnel, progression, bilans.
- [docs/SCORING.md](docs/SCORING.md) — note CoachGG, MVP, limites.
- [docs/DESKTOP.md](docs/DESKTOP.md) — application PC de capture (conception, contraintes).
- [docs/LEGAL.md](docs/LEGAL.md) — points juridiques et autorisations à faire valider.
- [docs/ROADMAP.md](docs/ROADMAP.md) — phases et prochaines étapes.
