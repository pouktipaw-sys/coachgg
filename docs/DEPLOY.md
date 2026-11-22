# Mettre CoachGG en ligne gratuitement (Oracle Cloud « Always Free »)

Résultat : un site accessible partout en HTTPS (`https://coachgg.<ton-ip>.sslip.io`), qui se met à jour **tout seul**
quelques minutes après chaque modification poussée sur GitHub. Coût : 0 € si tu restes dans l'offre gratuite.

Ce qui tourne sur le serveur (`docker-compose.yml`) : base PostgreSQL, site Next.js, worker vidéo (FFmpeg + Python/OpenCV),
Caddy (certificat HTTPS gratuit renouvelé automatiquement). Les vidéos et la base sont dans des volumes Docker persistants.

## 1. Créer le compte Oracle (10 min, une fois)

1. https://www.oracle.com/cloud/free/ → **Start for free**.
2. Région d'origine : choisis-en une proche (ex. *France Central (Paris)* ou *Germany Central (Frankfurt)*). **Elle ne pourra plus changer.**
3. Une carte bancaire est demandée pour vérifier l'identité : rien n'est prélevé tant que tu restes en « Always Free ».
   Si l'inscription est refusée, réessaie plus tard ou avec une autre carte (ça arrive).

## 2. Créer le serveur (5 min)

1. Menu ☰ → **Compute → Instances → Create instance**.
2. **Image** : *Canonical Ubuntu 24.04*.
3. **Shape** : *Change shape* → **Ampere** → `VM.Standard.A1.Flex` → **4 OCPU, 24 Go** (gratuit).
   Si Oracle répond « Out of capacity », prends 2 OCPU / 12 Go ou réessaie plus tard.
4. **Add SSH keys** : *Generate a key pair for me* → **Save private key** (garde ce fichier `.key`, c'est ta clé d'accès).
5. **Boot volume** : coche *Specify a custom boot volume size* → **150 Go** (gratuit jusqu'à 200 Go).
6. **Create**. Note l'**adresse IP publique** affichée.

## 3. Ouvrir le web dans le pare-feu Oracle (2 min)

Page de l'instance → **Subnet** (lien) → **Security Lists** → *Default Security List* → **Add Ingress Rules** :

| Source CIDR | Protocole | Port de destination |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(Le pare-feu interne du serveur est ouvert automatiquement par le script d'installation.)

## 4. Installer CoachGG (1 commande, 10-15 min)

Connexion au serveur depuis Windows (PowerShell), en remplaçant le chemin de la clé et l'IP :

```bash
ssh -i C:\Users\Vega\Downloads\ssh-key.key ubuntu@IP_DU_SERVEUR
```

Si Windows refuse la clé (« permissions too open ») :

```bash
icacls C:\Users\Vega\Downloads\ssh-key.key /inheritance:r /grant:r "%USERNAME%:R"
```

Puis, sur le serveur :

```bash
curl -fsSL https://raw.githubusercontent.com/pouktipaw-sys/coachgg/claude/peaceful-pasteur-j5bzj9/deploy/install.sh | bash
```

À la fin, le script affiche l'adresse du site, par ex. `https://coachgg.141-145-12-34.sslip.io`.
`sslip.io` est un service gratuit qui fait pointer ce nom vers ton IP : aucune inscription, et le HTTPS marche.

## 5. Ajouter les clés (Riot, Anthropic, email)

```bash
cd ~/coachgg && nano .env
```

Remplis `RIOT_API_KEY`, `ANTHROPIC_API_KEY`, `SMTP_URL`, `MAIL_FROM` (mêmes valeurs que sur ton PC), enregistre (Ctrl+O, Entrée, Ctrl+X), puis :

```bash
docker compose up -d
```

**Clé Riot** : une clé de développement expire toutes les 24 h. Pour un site ouvert à d'autres joueurs, demande une clé
*Personal* ou *Production* sur https://developer.riotgames.com (gratuit). En attendant, recolle la clé chaque jour avec la commande ci-dessus.

## Mises à jour automatiques

Toutes les 5 minutes, le serveur regarde la branche GitHub (`DEPLOY_BRANCH` dans `.env`). Si elle a changé : il construit la
nouvelle version **pendant que l'ancienne reste en ligne**, applique les migrations de base, puis bascule. Rien à faire.

```bash
tail -f ~/coachgg-update.log
```

(Journal des mises à jour. Forcer une mise à jour : `~/coachgg/deploy/auto-update.sh --force`.)

## Commandes utiles

| Besoin | Commande (dans `~/coachgg`) |
|---|---|
| État des services | `docker compose ps` |
| Journal du site / du worker | `docker compose logs -f web` · `docker compose logs -f worker` |
| Redémarrer | `docker compose restart` |
| Me passer administrateur | `docker compose exec web npm run admin:promote -- ton@email` |
| Sauvegarder la base | `docker compose exec db pg_dump -U coachgg coachgg > sauvegarde.sql` |
| Place disque restante | `df -h /` |

## Ton nom de domaine (optionnel)

Avec un domaine gratuit DuckDNS (`coachgg.duckdns.org`) ou acheté : fais-le pointer vers l'IP du serveur, puis dans `.env`
change `DOMAIN` et `APP_URL`, et lance `docker compose up -d`. Le certificat HTTPS est créé tout seul.

## Localhost et serveur

Même code (GitHub), **données séparées** : les comptes et vidéos du site en ligne ne sont pas dans ton localhost, et inversement.
Le localhost sert de terrain de test sans risque pour les vrais comptes.

---

# Alternative la plus simple : partager depuis son PC (tunnel Cloudflare)

Gratuit, sans compte ni carte, 5 minutes. Limite : le site n'est accessible que **pendant que ton PC est allumé**
avec l'appli lancée, et l'adresse change à chaque lancement du tunnel.

```bash
winget install Cloudflare.cloudflared
```

Terminal 1 (l'appli, comme d'habitude) : `npm run dev:all`

Terminal 2 :

```bash
cloudflared tunnel --url http://localhost:3000
```

L'adresse `https://xxxx.trycloudflare.com` affichée est utilisable depuis n'importe quel téléphone ou PC.
