#!/usr/bin/env bash
# Mise à jour automatique : si une nouvelle version est sur GitHub, la récupère et relance le site.
# Lancé toutes les 5 minutes par cron (voir deploy/install.sh). Journal : ~/coachgg-update.log
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="$(grep -E '^DEPLOY_BRANCH=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

exec 9>/tmp/coachgg-update.lock
flock -n 9 || exit 0 # une mise à jour est déjà en cours

git fetch -q origin "$BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
[ "$LOCAL" = "$REMOTE" ] && [ "${1:-}" != "--force" ] && exit 0

echo "$(date -u '+%F %T') mise à jour ${LOCAL:0:7} → ${REMOTE:0:7}"
git checkout -q "$BRANCH"
git reset -q --hard "origin/$BRANCH"
# Construit la nouvelle version AVANT d'arrêter l'ancienne : le site reste en ligne pendant la construction.
docker compose build
docker compose up -d
docker image prune -f >/dev/null
echo "$(date -u '+%F %T') en ligne : $(git log -1 --format='%h %s')"
