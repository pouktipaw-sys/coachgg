#!/usr/bin/env bash
# Installation de CoachGG sur un serveur Ubuntu neuf (Oracle Cloud Always Free, ARM ou x86).
# À lancer UNE fois, connecté au serveur :
#   curl -fsSL https://raw.githubusercontent.com/pouktipaw-sys/coachgg/claude/peaceful-pasteur-j5bzj9/deploy/install.sh | bash
# Relançable sans risque : ne remplace jamais un .env existant.
set -euo pipefail

REPO="${REPO:-https://github.com/pouktipaw-sys/coachgg.git}"
BRANCH="${BRANCH:-claude/peaceful-pasteur-j5bzj9}"
DIR="${DIR:-$HOME/coachgg}"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

say "1/6 Docker et Git"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo apt-get install -y -qq git cron >/dev/null
sudo usermod -aG docker "$USER" || true
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"

say "2/6 Ouverture des ports 80 et 443 (pare-feu du serveur)"
# Les images Ubuntu d'Oracle bloquent tout sauf SSH : on autorise le web.
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$p" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null 2>&1 || true; else
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null && sudo netfilter-persistent save >/dev/null 2>&1 || true
fi

say "3/6 Code de CoachGG ($BRANCH)"
if [ ! -d "$DIR/.git" ]; then git clone -q --branch "$BRANCH" "$REPO" "$DIR"; fi
cd "$DIR"
git fetch -q origin "$BRANCH" && git checkout -q "$BRANCH" && git reset -q --hard "origin/$BRANCH"

say "4/6 Fichier de configuration (.env)"
if [ ! -f .env ]; then
  IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)"
  DOMAIN="coachgg.${IP//./-}.sslip.io"
  cat > .env <<EOF
# ─── Mise en ligne (créé par deploy/install.sh) ───
DOMAIN="$DOMAIN"
APP_URL="https://$DOMAIN"
DEPLOY_BRANCH="$BRANCH"
DB_PASSWORD="$(openssl rand -hex 24)"

# ─── Clés (à remplir : nano .env, puis docker compose up -d) ───
RIOT_API_KEY=""
ANTHROPIC_API_KEY=""
SMTP_URL=""
MAIL_FROM="CoachGG <no-reply@$DOMAIN>"

# ─── Limites (disque gratuit Oracle : 200 Go) ───
MAX_UPLOAD_BYTES=4294967296
USER_STORAGE_QUOTA_BYTES=5368709120
FFMPEG_THREADS=2
ANALYSIS_AI_BUDGET_USD="1.5"
ANALYSIS_AI_MAX_MOMENTS="3"
EOF
  chmod 600 .env
  echo "Adresse du site : https://$DOMAIN"
else
  echo ".env déjà présent : conservé."
fi

say "5/6 Construction et démarrage (5 à 15 minutes la première fois)"
$DOCKER compose up -d --build

say "6/6 Mise à jour automatique toutes les 5 minutes"
chmod +x deploy/auto-update.sh
LINE="*/5 * * * * $DIR/deploy/auto-update.sh >> $HOME/coachgg-update.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'deploy/auto-update.sh' ; echo "$LINE" ) | crontab -
# cron tourne sans le groupe docker tant que la session n'est pas rouverte : sudo n'est pas nécessaire ensuite.

DOMAIN_NOW="$(grep -E '^DOMAIN=' .env | cut -d= -f2- | tr -d '"')"
printf '\n\033[1;32m✔ CoachGG est en ligne : https://%s\033[0m\n' "$DOMAIN_NOW"
echo "  (le certificat HTTPS peut prendre 1 minute à apparaître la première fois)"
echo "  Ajouter tes clés :  cd $DIR && nano .env && docker compose up -d"
echo "  Journal des mises à jour : tail -f ~/coachgg-update.log"
