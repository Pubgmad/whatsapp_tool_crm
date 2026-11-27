#!/usr/bin/env bash
# Isolated MathStrat CRM staging on the same VPS as production.
# SAFE: does not touch /var/www/whatsapp-crm, PM2 whatsapp-crm*, prod DB, or Meta prod webhooks.
set -euo pipefail

PROD_DIR=/var/www/whatsapp-crm
STAGING_DIR=/var/www/whatsapp-crm-staging
BRANCH=release/whatsapp-automation-production
REPO_URL=${REPO_URL:-https://github.com/Pubgmad/whatsapp_tool_crm.git}
STAGING_PORT=3001
DB_NAME=whatsapp_crm_staging
DB_USER=whatsapp_crm_staging_user

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as deploy (not root)."
  exit 1
fi

if [[ ! -d "$PROD_DIR" ]]; then
  echo "Production directory missing; aborting for safety."
  exit 1
fi

echo "==> Creating isolated staging directory (not $PROD_DIR)"
sudo mkdir -p "$STAGING_DIR"
sudo chown "$(whoami):$(whoami)" "$STAGING_DIR"

if [[ ! -d "$STAGING_DIR/.git" ]]; then
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$STAGING_DIR"
else
  cd "$STAGING_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

cd "$STAGING_DIR"
COMMIT=$(git rev-parse --short HEAD)
echo "Staging commit: $COMMIT"

if [[ ! -f .env.local ]]; then
  if [[ -f deploy/staging.env.example ]]; then
    cp deploy/staging.env.example .env.local
    echo "Created .env.local from deploy/staging.env.example — edit secrets before start."
  else
    echo "Missing .env.local and staging.env.example"
    exit 1
  fi
fi

echo "==> Ensure staging database exists (separate from production whatsapp_crm)"
echo "Run as postgres once if needed:"
echo "  sudo -u postgres psql -c \"CREATE USER $DB_USER WITH PASSWORD 'CHANGE_ME';\""
echo "  sudo -u postgres psql -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\""
echo "  sudo -u postgres psql -c \"GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;\""

read -r -p "Confirm .env.local DATABASE_URL points ONLY at $DB_NAME (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi

npm ci
npm run db:init
npx next build --webpack

echo "==> Starting staging PM2 apps only (not production)"
pm2 start ecosystem.staging.config.cjs
pm2 save

echo "Done. Staging on port $STAGING_PORT at commit $COMMIT."
echo "Point a separate nginx vhost at 127.0.0.1:$STAGING_PORT."
echo "Do NOT attach production Meta webhooks to staging APP_URL."
