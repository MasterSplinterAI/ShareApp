#!/bin/bash
# Deployment script for the LiveKit ShareApp (frontend + backend).
# Translation agent runs on LiveKit Cloud and is NOT managed here.
#
# Behavior:
#   1. If the local working tree has changes, offer to commit + push.
#   2. SSH to the server, fetch latest into the bare repo, check out to a
#      temp dir, build the frontend only if its sources changed, rsync
#      the backend and frontend into place, restart pm2.
#
# Critical invariant: /var/www/share-app/livekit-app/backend/.env is NEVER
# deleted. We back it up before touching the backend dir and restore it
# afterwards, regardless of whether backend deps changed.

set -euo pipefail

REMOTE_USER="ubuntu"
REMOTE_HOST="3.16.210.84"
PEM_KEY="$HOME/Downloads/AxisAlgo.pem"
APP_DIR="/var/www/share-app"
BACKEND_DIR="$APP_DIR/livekit-app/backend"
FRONTEND_DIR="$APP_DIR/livekit-app/frontend"
GIT_REPO="/home/ubuntu/git/share-app.git"

echo "=== ShareApp deploy ==="

if [ ! -f "$PEM_KEY" ]; then
  echo "Error: PEM key not found at $PEM_KEY" >&2
  exit 1
fi

# 1. Local git — optional commit + push.
echo "=== Step 1: local git status ==="
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes detected."
  read -r -p "Commit message (empty to skip commit and deploy current HEAD): " COMMIT_MSG
  if [ -n "$COMMIT_MSG" ]; then
    git add -A
    git commit -m "$COMMIT_MSG"
    git push origin main
  else
    echo "Skipping commit — deploying current origin/main."
  fi
else
  echo "Working tree clean. Deploying origin/main."
fi

# 2. Remote deploy.
echo "=== Step 2: deploy to $REMOTE_HOST ==="
ssh -i "$PEM_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "APP_DIR='$APP_DIR' BACKEND_DIR='$BACKEND_DIR' FRONTEND_DIR='$FRONTEND_DIR' GIT_REPO='$GIT_REPO' bash -s" <<'REMOTE'
set -euo pipefail

echo "Fetching latest code..."
git --git-dir="$GIT_REPO" fetch origin main >/dev/null 2>&1 \
  || git --git-dir="$GIT_REPO" fetch origin master >/dev/null 2>&1

OLD_COMMIT="$(git --git-dir="$GIT_REPO" rev-parse HEAD 2>/dev/null || echo '')"
NEW_COMMIT="$(git --git-dir="$GIT_REPO" rev-parse FETCH_HEAD 2>/dev/null || echo '')"

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ] && [ -n "$OLD_COMMIT" ]; then
  echo "No new commits on server git ($OLD_COMMIT). Nothing to deploy."
  exit 0
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
echo "Temp checkout: $TEMP_DIR"

git --work-tree="$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f FETCH_HEAD >/dev/null 2>&1 \
  || git --work-tree="$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f main >/dev/null 2>&1

LATEST_COMMIT="$(git --git-dir="$GIT_REPO" rev-parse FETCH_HEAD 2>/dev/null || git --git-dir="$GIT_REPO" rev-parse HEAD)"
echo "Deploying commit: $LATEST_COMMIT"

# Figure out which parts changed so we can skip unneeded work.
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
  echo "$CHANGED_FILES" | grep -q '^livekit-app/frontend/'        && NEED_FRONTEND_BUILD=true  || true
  echo "$CHANGED_FILES" | grep -q '^livekit-app/backend/package'  && NEED_BACKEND_INSTALL=true || true
fi

# If package-lock changed but git diff missed it, still install backend deps (avoids MODULE_NOT_FOUND after code-only rsync).
if [ "$NEED_BACKEND_INSTALL" != true ] && [ -f "$BACKEND_DIR/package-lock.json" ]; then
  if ! cmp -s "$TEMP_DIR/livekit-app/backend/package-lock.json" "$BACKEND_DIR/package-lock.json" 2>/dev/null; then
    NEED_BACKEND_INSTALL=true
  fi
fi

# ---------- Backend ----------
# ALWAYS preserve the production .env. This is the production secret store;
# it is NOT in git and must survive every deploy.
ENV_BACKUP=''
if [ -f "$BACKEND_DIR/.env" ]; then
  ENV_BACKUP="$(mktemp)"
  sudo cp "$BACKEND_DIR/.env" "$ENV_BACKUP"
  sudo chown "$USER:$USER" "$ENV_BACKUP"
  chmod 600 "$ENV_BACKUP"
  echo "Preserved backend/.env -> $ENV_BACKUP"
else
  echo "WARNING: no existing backend/.env; nothing to preserve. You must create one on the server before the backend will work." >&2
fi

if [ "$NEED_BACKEND_INSTALL" = true ] || [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "Backend: full sync (deps may have changed)..."
  sudo mkdir -p "$BACKEND_DIR"
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

# Restore .env — belt and suspenders. Even though rsync excludes .env above,
# we restore from our own backup to guarantee the file exists and is intact.
if [ -n "$ENV_BACKUP" ]; then
  sudo cp "$ENV_BACKUP" "$BACKEND_DIR/.env"
  sudo chown ubuntu:ubuntu "$BACKEND_DIR/.env"
  sudo chmod 600 "$BACKEND_DIR/.env"
  rm -f "$ENV_BACKUP"
  echo "Restored backend/.env"
fi

# ---------- Frontend ----------
if [ "$NEED_FRONTEND_BUILD" = true ] || [ ! -f "$FRONTEND_DIR/index.html" ]; then
  echo "Building frontend..."
  cd "$TEMP_DIR/livekit-app/frontend"
  # Reuse existing server-side node_modules if the lockfile hasn't changed.
  if [ -d "$FRONTEND_DIR/node_modules" ] \
     && cmp -s "$FRONTEND_DIR/package-lock.json" "$TEMP_DIR/livekit-app/frontend/package-lock.json"; then
    cp -r "$FRONTEND_DIR/node_modules" .
  else
    npm ci --prefer-offline --no-audit --silent 2>/dev/null \
      || npm install --prefer-offline --no-audit --silent
  fi
  npm run build --silent

  sudo mkdir -p "$FRONTEND_DIR"
  sudo rsync -a --delete "$TEMP_DIR/livekit-app/frontend/dist/" "$FRONTEND_DIR/"
else
  echo "Frontend: no source changes, skipping build."
fi

# Keep things tidy.
sudo chown -R ubuntu:ubuntu "$APP_DIR"
sudo find "$FRONTEND_DIR" -maxdepth 1 -name '*.log' -type f -delete 2>/dev/null || true

# ---------- Services ----------
echo "Restarting backend..."
if pm2 describe livekit-backend >/dev/null 2>&1; then
  pm2 restart livekit-backend --update-env
else
  cd "$BACKEND_DIR"
  pm2 start server.js --name livekit-backend --update-env
fi
pm2 save >/dev/null

# Translation agent runs on LiveKit Cloud — nothing to restart here.

echo "Deployed commit: $LATEST_COMMIT"
REMOTE

echo ""
echo "=== Deploy finished ==="
echo "Health check:"
ssh -i "$PEM_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  'curl -sS -o /dev/null -w "  /api/health: %{http_code}\n" http://127.0.0.1:3001/api/health'
