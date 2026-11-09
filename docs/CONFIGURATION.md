# Configuration

Toutes les variables sont lues côté serveur. Copiez `.env.example` en `.env`. Ne committez jamais `.env`.

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL (lu par `prisma.config.ts` et `src/server/db.ts`). |
| `DATABASE_POOL_MAX` | 10 | Connexions max. du pool (adaptateur pg). |
| `APP_URL` | `http://localhost:3000` | Origine publique (contrôle CSRF, liens). |
| `STORAGE_DIR` | `./storage` | Stockage privé des vidéos (driver disque). |
| `MAX_UPLOAD_BYTES` | 4 Go | Taille max d'un fichier. |
| `USER_STORAGE_QUOTA_BYTES` | 20 Go | Quota par utilisateur. |
| `MAX_VIDEO_DURATION_SEC` | 10800 | Durée max acceptée. |
| `UPLOAD_CHUNK_BYTES` | 8 Mo | Taille des morceaux. Un proxy devant l'app doit accepter des corps de cette taille. |
| `FFMPEG_THREADS` | 2 | Threads de transcodage. |
| `FFMPEG_TIMEOUT_SEC` | 3600 | Durée max d'un traitement. |
| `RIOT_API_KEY` | vide | Active l'import Riot. |
| `MAILER` | `console` | Seule valeur supportée actuellement. |

## Intégrations externes

### Riot Games API — non bloquante
- **Sans clé** : saisie manuelle des statistiques ; tout le reste fonctionne.
- **Clé de développement** (developer.riotgames.com) : expire toutes les 24 h, débit limité — tests uniquement.
- **Clé de production** : demande d'enregistrement de produit auprès de Riot, à faire valider (description du produit, conformité aux politiques développeur).
- Endpoints utilisés : `ACCOUNT-V1 /riot/account/v1/accounts/by-riot-id`, `MATCH-V5 /lol/match/v5/matches/by-puuid/{puuid}/ids`, `MATCH-V5 /lol/match/v5/matches/{id}`. Non utilisés pour l'instant : LEAGUE-V4 (rang), MATCH-V5 timeline (évolution minute par minute).
- **Riot Sign On (RSO)** : nécessaire pour **prouver** qu'un joueur possède un Riot ID. Accordé par Riot à des applications approuvées. En attendant, les identités sont « déclarées » et l'interface le dit.

### Email — non configuré
L'interface `src/server/mailer.ts` doit être branchée sur un fournisseur (SMTP ou API) pour : récupération de mot de passe en production, invitations à des personnes sans compte. En développement, les messages sont écrits dans les logs serveur.

### Stockage objet — optionnel
Le driver disque suffit sur un serveur unique. Pour plusieurs instances, implémenter `StorageDriver` (`src/server/storage/index.ts`) sur un stockage S3-compatible **privé** ; le worker télécharge alors l'original dans un dossier temporaire.

## Déploiement (minimal)

```bash
npm ci && npx prisma migrate deploy && npm run build
```

```bash
npm run start
```

```bash
npm run worker
```

Recommandations : HTTPS obligatoire (cookies `Secure`) ; worker dans un conteneur aux ressources limitées ; sauvegarde PostgreSQL + dossier de stockage ; un seul worker suffit au départ (plusieurs possibles grâce à `SKIP LOCKED`).
