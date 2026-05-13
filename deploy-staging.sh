#!/bin/bash
# Staging deployment script for ShareApp v2 work.
# Deploy target:
#   - Frontend: /var/www/share-app-staging/livekit-app/frontend
#   - Backend:  /var/www/share-app-staging/livekit-app/backend (PM2: livekit-backend-staging)
#
# This script is intentionally separate from deploy.sh so production deploy flow
# remains untouched while v2 is built out.

set -euo pipefail

REMOTE_USER="ubuntu"
REMOTE_HOST="3.16.210.84"
PEM_KEY="$HOME/Downloads/AxisAlgo.pem"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-v2-foundation}"
STAGING_BACKEND_PORT="${STAGING_BACKEND_PORT:-3101}"
APP_DIR="/var/www/share-app-staging"
BACKEND_DIR="$APP_DIR/livekit-app/backend"
FRONTEND_DIR="$APP_DIR/livekit-app/frontend"
GIT_REPO="/home/ubuntu/git/share-app.git"
PM2_NAME="livekit-backend-staging"

echo "=== ShareApp STAGING deploy ($DEPLOY_BRANCH) ==="

if [ ! -f "$PEM_KEY" ]; then
  echo "Error: PEM key not found at $PEM_KEY" >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$DEPLOY_BRANCH" ]; then
  echo "Warning: current branch is '$CURRENT_BRANCH', but deploy branch is '$DEPLOY_BRANCH'."
fi

echo "=== Step 1: local git status ==="
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes detected."
  read -r -p "Commit message (empty to skip commit and deploy current remote branch HEAD): " COMMIT_MSG
  if [ -n "$COMMIT_MSG" ]; then
    git add -A
    git commit -m "$COMMIT_MSG"
    git push origin "$DEPLOY_BRANCH"
  else
    echo "Skipping commit — deploying current origin/$DEPLOY_BRANCH."
  fi
else
  echo "Working tree clean. Deploying origin/$DEPLOY_BRANCH."
fi

echo "=== Step 2: deploy $DEPLOY_BRANCH to $REMOTE_HOST ==="
ssh -i "$PEM_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "APP_DIR='$APP_DIR' BACKEND_DIR='$BACKEND_DIR' FRONTEND_DIR='$FRONTEND_DIR' GIT_REPO='$GIT_REPO' DEPLOY_BRANCH='$DEPLOY_BRANCH' PM2_NAME='$PM2_NAME' STAGING_BACKEND_PORT='$STAGING_BACKEND_PORT' bash -s" <<'REMOTE'
set -euo pipefail

echo "Fetching latest code..."
OLD_COMMIT="$(git --git-dir="$GIT_REPO" rev-parse --verify "refs/heads/$DEPLOY_BRANCH" 2>/dev/null || echo '')"
git --git-dir="$GIT_REPO" fetch origin "$DEPLOY_BRANCH:$DEPLOY_BRANCH" >/dev/null 2>&1
NEW_COMMIT="$(git --git-dir="$GIT_REPO" rev-parse --verify "refs/heads/$DEPLOY_BRANCH" 2>/dev/null || echo '')"

if [ -z "$NEW_COMMIT" ]; then
  echo "Branch origin/$DEPLOY_BRANCH not found on remote bare repo." >&2
  exit 1
fi

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ] && [ -n "$OLD_COMMIT" ]; then
  echo "No new commits for $DEPLOY_BRANCH ($OLD_COMMIT). Nothing to deploy."
  exit 0
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
echo "Temp checkout: $TEMP_DIR"

git --work-tree="$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f "$NEW_COMMIT" >/dev/null 2>&1
echo "Deploying commit: $NEW_COMMIT"

if [ -n "$OLD_COMMIT" ]; then
  CHANGED_FILES="$(git --git-dir="$GIT_REPO" diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" 2>/dev/null || echo '')"
else
  CHANGED_FILES=''
fi

NEED_FRONTEND_BUILD=false
NEED_BACKEND_INSTALL=false
if [ -z "$CHANGED_FILES" ]; then
  NEED_FRONTEND_BUILD=true
  NEED_BACKEND_INSTALL=true
else
  echo "$CHANGED_FILES" | grep -q '^livekit-app/frontend/'       && NEED_FRONTEND_BUILD=true || true
  echo "$CHANGED_FILES" | grep -q '^livekit-app/backend/package' && NEED_BACKEND_INSTALL=true || true
fi

if [ "$NEED_BACKEND_INSTALL" != true ] && [ -f "$BACKEND_DIR/package-lock.json" ]; then
  if ! cmp -s "$TEMP_DIR/livekit-app/backend/package-lock.json" "$BACKEND_DIR/package-lock.json" 2>/dev/null; then
    NEED_BACKEND_INSTALL=true
  fi
fi

sudo mkdir -p "$BACKEND_DIR" "$FRONTEND_DIR"

# ---------- Backend ----------
ENV_BACKUP=''
if [ -f "$BACKEND_DIR/.env" ]; then
  ENV_BACKUP="$(mktemp)"
  sudo cp "$BACKEND_DIR/.env" "$ENV_BACKUP"
  sudo chown "$USER:$USER" "$ENV_BACKUP"
  chmod 600 "$ENV_BACKUP"
  echo "Preserved staging backend/.env -> $ENV_BACKUP"
fi

if [ "$NEED_BACKEND_INSTALL" = true ] || [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "Backend: full sync (deps may have changed)..."
  sudo rsync -a --delete \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude 'node_modules' \
    --exclude 'translations.db' \
    --exclude 'v2-platform.db' \
    --exclude 'uploads' \
    "$TEMP_DIR/livekit-app/backend/" "$BACKEND_DIR/"
  cd "$BACKEND_DIR"
  npm install --production --prefer-offline --no-audit --silent
else
  echo "Backend: code-only sync (node_modules preserved)..."
  sudo rsync -a \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude 'node_modules' \
    --exclude 'translations.db' \
    --exclude 'v2-platform.db' \
    --exclude 'uploads' \
    "$TEMP_DIR/livekit-app/backend/" "$BACKEND_DIR/"
fi

if [ -n "$ENV_BACKUP" ]; then
  sudo cp "$ENV_BACKUP" "$BACKEND_DIR/.env"
  sudo chown ubuntu:ubuntu "$BACKEND_DIR/.env"
  sudo chmod 600 "$BACKEND_DIR/.env"
  rm -f "$ENV_BACKUP"
  echo "Restored staging backend/.env"
fi

# ---------- Frontend ----------
if [ "$NEED_FRONTEND_BUILD" = true ] || [ ! -f "$FRONTEND_DIR/index.html" ]; then
  echo "Building frontend..."
  cd "$TEMP_DIR/livekit-app/frontend"
  if [ -d "$FRONTEND_DIR/node_modules" ] \
     && cmp -s "$FRONTEND_DIR/package-lock.json" "$TEMP_DIR/livekit-app/frontend/package-lock.json"; then
    cp -r "$FRONTEND_DIR/node_modules" .
  else
    npm ci --prefer-offline --no-audit --silent 2>/dev/null \
      || npm install --prefer-offline --no-audit --silent
  fi
  # Staging: show "Try V2 workspace" on classic home (build-time flag only for this deploy path).
  export VITE_V2_ENTRY_ENABLED="${VITE_V2_ENTRY_ENABLED:-true}"
  npm run build --silent
  sudo rsync -a --delete "$TEMP_DIR/livekit-app/frontend/dist/" "$FRONTEND_DIR/"
else
  echo "Frontend: no source changes, skipping build."
fi

sudo chown -R ubuntu:ubuntu "$APP_DIR"

# ---------- Services ----------
echo "Restarting staging backend ($PM2_NAME)..."
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  cd "$BACKEND_DIR"
  pm2 start server.js --name "$PM2_NAME" --update-env
fi
pm2 save >/dev/null

echo "Deployed $DEPLOY_BRANCH commit: $NEW_COMMIT"
REMOTE

echo ""
echo "=== Staging deploy finished ==="
echo "Health check:"
ssh -i "$PEM_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "curl -sS -o /dev/null -w '  /api/health ($STAGING_BACKEND_PORT): %{http_code}\n' http://127.0.0.1:$STAGING_BACKEND_PORT/api/health"
