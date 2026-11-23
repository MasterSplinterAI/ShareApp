#!/bin/bash
# Atomic blue-green deploy for the Lalia app (lalia.cloud).
# Releases live under:
#   - Releases: /var/www/share-app-staging/releases/<YYYYMMDDHHMMSS>-<sha>
#   - Active:   /var/www/share-app-staging/current -> active release dir
#   - Shared:   /var/www/share-app-staging/shared/backend/{.env,uploads,translations.db,v2-platform.db}
#   - Slots:    blue (127.0.0.1:3101, PM2: lalia-backend-blue)
#               green (127.0.0.1:3102, PM2: lalia-backend-green)
#   - Upstream: /etc/nginx/conf.d/lalia-upstream.conf
#
# Usage:
#   ./deploy.sh                  # deploy origin/main cleanly without interrupting active meetings
#   ./deploy.sh --rollback       # flip traffic atomically back to the previous release
#   ./deploy.sh --rollback <id>  # flip traffic atomically to a specific release ID in releases/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE_USER="ubuntu"
REMOTE_HOST="3.16.210.84"
PEM_KEY="$HOME/Downloads/AxisAlgo.pem"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
FORCE_FRONTEND_BUILD="${FORCE_FRONTEND_BUILD:-false}"
FORCE_DEPLOY="${FORCE_DEPLOY:-false}"
APP_DIR="/var/www/share-app-staging"
GIT_REPO="/home/ubuntu/git/share-app.git"
NGINX_STAGING_DEST="/etc/nginx/sites-available/staging.jarmetals.com"
UPSTREAM_CONF="/etc/nginx/conf.d/lalia-upstream.conf"

ACTION="deploy"
ROLLBACK_TARGET=""
if [ "${1:-}" = "--rollback" ]; then
  ACTION="rollback"
  ROLLBACK_TARGET="${2:-}"
fi

if [ ! -f "$PEM_KEY" ]; then
  echo "Error: PEM key not found at $PEM_KEY" >&2
  exit 1
fi

if [ "$ACTION" = "rollback" ]; then
  echo "=== ShareApp ATOMIC ROLLBACK ==="
  HELPERS_B64="$(base64 < "$SCRIPT_DIR/deploy/atomic-helpers.sh" | tr -d '\n')"
  ssh -i "$PEM_KEY" "$REMOTE_USER@$REMOTE_HOST" \
    "APP_DIR='$APP_DIR' UPSTREAM_CONF='$UPSTREAM_CONF' ROLLBACK_TARGET='$ROLLBACK_TARGET' HELPERS_B64='$HELPERS_B64' bash -s" <<'ROLLBACK'
set -euo pipefail

HELPERS_TMP="$(mktemp)"
NEXT_PM2_STARTED=""
ROLLBACK_DONE=false
PREV_CURRENT_TARGET="$(readlink -f "$APP_DIR/current" 2>/dev/null || echo '')"

cleanup_rollback() {
  rm -f "$HELPERS_TMP"
  if [ "$ROLLBACK_DONE" != true ] && [ -n "${NEXT_PM2_STARTED:-}" ]; then
    pm2 delete "$NEXT_PM2_STARTED" >/dev/null 2>&1 || true
  fi
}
trap cleanup_rollback EXIT

printf '%s' "$HELPERS_B64" | base64 -d > "$HELPERS_TMP"
# shellcheck source=/dev/null
source "$HELPERS_TMP"

RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
if [ ! -d "$RELEASES_DIR" ]; then
  echo "No releases directory found at $RELEASES_DIR" >&2
  exit 1
fi

TARGET_DIR=""
if [ -n "$ROLLBACK_TARGET" ]; then
  if [ -d "$RELEASES_DIR/$ROLLBACK_TARGET" ]; then
    TARGET_DIR="$RELEASES_DIR/$ROLLBACK_TARGET"
  else
    echo "Release not found: $RELEASES_DIR/$ROLLBACK_TARGET" >&2
    exit 1
  fi
else
  while IFS= read -r rel_name; do
    [ -z "$rel_name" ] && continue
    cand="$RELEASES_DIR/$rel_name"
    [ -d "$cand" ] || continue
    cand_real="$(cd -P "$cand" 2>/dev/null && pwd -P || true)"
    if [ "$cand_real" != "$PREV_CURRENT_TARGET" ]; then
      TARGET_DIR="$cand"
      break
    fi
  done < <(ls -1 "$RELEASES_DIR" 2>/dev/null | LC_ALL=C sort -r)
fi

if [ -z "$TARGET_DIR" ]; then
  echo "No alternate previous release available in $RELEASES_DIR to roll back to." >&2
  exit 1
fi

TARGET_BACKEND="$TARGET_DIR/livekit-app/backend"
TARGET_FRONTEND="$TARGET_DIR/livekit-app/frontend"
if [ ! -f "$TARGET_BACKEND/server.js" ] || [ ! -f "$TARGET_FRONTEND/index.html" ]; then
  echo "Rollback target $TARGET_DIR is incomplete." >&2
  exit 1
fi

read -r NEXT_SLOT NEXT_PORT NEXT_PM2 PREV_PORT PREV_PM2 < <(select_inactive_slot "$UPSTREAM_CONF")
echo "Rolling back $PREV_CURRENT_TARGET -> $TARGET_DIR on slot $NEXT_SLOT (port $NEXT_PORT)..."

pm2 delete "$NEXT_PM2" >/dev/null 2>&1 || true
cd "$TARGET_BACKEND"
PORT="$NEXT_PORT" FRONTEND_URL="https://lalia.cloud" PUBLIC_FRONTEND_BASE_URL="https://lalia.cloud" \
  pm2 start "$TARGET_BACKEND/server.js" --name "$NEXT_PM2" --cwd "$TARGET_BACKEND" --kill-timeout 40000 --update-env
NEXT_PM2_STARTED="$NEXT_PM2"

wait_for_slot_health "$NEXT_PORT" 60 1 3

TMP_UPSTREAM="$(mktemp)"
write_upstream_conf "$TMP_UPSTREAM" "$NEXT_PORT"
sudo install -m 644 "$TMP_UPSTREAM" "$UPSTREAM_CONF"
rm -f "$TMP_UPSTREAM"

atomic_swap_symlink "$TARGET_DIR" "$CURRENT_LINK"
if ! sudo nginx -t; then
  if [ -n "$PREV_CURRENT_TARGET" ]; then
    atomic_swap_symlink "$PREV_CURRENT_TARGET" "$CURRENT_LINK"
  fi
  TMP_UPSTREAM="$(mktemp)"
  write_upstream_conf "$TMP_UPSTREAM" "$PREV_PORT"
  sudo install -m 644 "$TMP_UPSTREAM" "$UPSTREAM_CONF"
  rm -f "$TMP_UPSTREAM"
  exit 1
fi
sudo systemctl reload nginx
ROLLBACK_DONE=true

sleep 2
if pm2 describe "$PREV_PM2" >/dev/null 2>&1; then
  pm2 delete "$PREV_PM2" || true
fi
pm2 save >/dev/null

echo "Rollback active: $(readlink -f "$CURRENT_LINK") serving via $NEXT_SLOT (port $NEXT_PORT)"
ROLLBACK
  exit 0
fi

echo "=== ShareApp ATOMIC deploy ($DEPLOY_BRANCH) ==="

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$DEPLOY_BRANCH" ]; then
  echo "Warning: current branch is '$CURRENT_BRANCH', but deploy branch is '$DEPLOY_BRANCH'."
fi

echo "=== Step 1: local git status ==="
# Never auto git-add everything from this script (secret / env risk). Commit deliberately first.
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes detected. Commit and push intentionally, then re-run deploy."
  echo "Deploy will use origin/$DEPLOY_BRANCH only (no local auto-commit)."
  git status --short
  read -r -p "Re-run deploy of current origin/$DEPLOY_BRANCH anyway? [y/N] " CONTINUE_DIRTY
  if [[ ! "${CONTINUE_DIRTY:-}" =~ ^[Yy]$ ]]; then
    echo "Aborting deploy."
    exit 1
  fi
  echo "Skipping local commit — deploying current origin/$DEPLOY_BRANCH."
else
  echo "Working tree clean. Deploying origin/$DEPLOY_BRANCH."
fi

echo "=== Step 2: deploy $DEPLOY_BRANCH to $REMOTE_HOST ==="
ssh -i "$PEM_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "APP_DIR='$APP_DIR' GIT_REPO='$GIT_REPO' DEPLOY_BRANCH='$DEPLOY_BRANCH' FORCE_FRONTEND_BUILD='$FORCE_FRONTEND_BUILD' FORCE_DEPLOY='$FORCE_DEPLOY' NGINX_STAGING_DEST='$NGINX_STAGING_DEST' UPSTREAM_CONF='$UPSTREAM_CONF' bash -s" <<'REMOTE'
set -euo pipefail

echo "Fetching latest code..."
OLD_COMMIT="$(git --git-dir="$GIT_REPO" rev-parse --verify "refs/heads/$DEPLOY_BRANCH" 2>/dev/null || echo '')"
git --git-dir="$GIT_REPO" fetch origin "$DEPLOY_BRANCH:$DEPLOY_BRANCH" >/dev/null 2>&1
NEW_COMMIT="$(git --git-dir="$GIT_REPO" rev-parse --verify "refs/heads/$DEPLOY_BRANCH" 2>/dev/null || echo '')"

if [ -z "$NEW_COMMIT" ]; then
  echo "Branch origin/$DEPLOY_BRANCH not found on remote bare repo." >&2
  exit 1
fi

CURRENT_LINK="$APP_DIR/current"
if [ "$OLD_COMMIT" = "$NEW_COMMIT" ] && [ -n "$OLD_COMMIT" ] && [ -L "$CURRENT_LINK" ] && [ "${FORCE_FRONTEND_BUILD:-false}" != true ] && [ "${FORCE_DEPLOY:-false}" != true ]; then
  echo "No new commits for $DEPLOY_BRANCH ($OLD_COMMIT). Nothing to deploy."
  exit 0
fi
if [ "$OLD_COMMIT" = "$NEW_COMMIT" ] && { [ "${FORCE_FRONTEND_BUILD:-false}" = true ] || [ "${FORCE_DEPLOY:-false}" = true ] || [ ! -L "$CURRENT_LINK" ]; }; then
  echo "Deploying $NEW_COMMIT (re-release / migration / build requested)."
fi

TEMP_DIR="$(mktemp -d)"
RELEASES_DIR="$APP_DIR/releases"
SHARED_DIR="$APP_DIR/shared"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-${NEW_COMMIT:0:12}"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
PREV_APP_ROOT="$(readlink -f "$CURRENT_LINK" 2>/dev/null || echo "$APP_DIR")"
PREV_BACKEND_DIR="$PREV_APP_ROOT/livekit-app/backend"
PREV_FRONTEND_DIR="$PREV_APP_ROOT/livekit-app/frontend"
PREV_VENDOR_DIR="$PREV_APP_ROOT/livekit-app/vendor"
BACKEND_DIR="$RELEASE_DIR/livekit-app/backend"
FRONTEND_DIR="$RELEASE_DIR/livekit-app/frontend"
VENDOR_DIR="$RELEASE_DIR/livekit-app/vendor"
AGENT_DIR="$APP_DIR/livekit-app/translation-agent"
FRONTEND_CACHE_DIR="$SHARED_DIR/build-cache/frontend"
DEPLOY_CUTOVER_DONE=false
NEXT_PM2_STARTED=""
PREV_CURRENT_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || echo '')"
PREV_UPSTREAM_PORT=""

cleanup_on_exit() {
  rm -rf "$TEMP_DIR"
  if [ "$DEPLOY_CUTOVER_DONE" != true ]; then
    if [ -n "${PREV_UPSTREAM_PORT:-}" ] && [ -f "$UPSTREAM_CONF" ]; then
      TMP_RESTORE="$(mktemp)"
      cat >"$TMP_RESTORE" <<EOF
upstream lalia_backend {
    server 127.0.0.1:${PREV_UPSTREAM_PORT};
    keepalive 32;
}
EOF
      sudo install -m 644 "$TMP_RESTORE" "$UPSTREAM_CONF" >/dev/null 2>&1 || true
      rm -f "$TMP_RESTORE"
    fi
    if [ -n "${PREV_CURRENT_TARGET:-}" ] && [ -d "${PREV_CURRENT_TARGET:-}" ]; then
      ln -sfn "$PREV_CURRENT_TARGET" "$CURRENT_LINK" 2>/dev/null || true
    fi
    if [ -n "${NEXT_PM2_STARTED:-}" ]; then
      pm2 delete "$NEXT_PM2_STARTED" >/dev/null 2>&1 || true
    fi
    if [ -n "${RELEASE_DIR:-}" ] && [ -d "${RELEASE_DIR:-}" ]; then
      sudo rm -rf "$RELEASE_DIR" >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup_on_exit EXIT

echo "Temp checkout: $TEMP_DIR"
echo "Staging release: $RELEASE_DIR ($NEW_COMMIT)"

git --work-tree="$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f "$NEW_COMMIT" >/dev/null 2>&1
# shellcheck source=/dev/null
source "$TEMP_DIR/deploy/atomic-helpers.sh"

if [ -n "$OLD_COMMIT" ] && [ -L "$CURRENT_LINK" ]; then
  CHANGED_FILES="$(git --git-dir="$GIT_REPO" diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" 2>/dev/null || echo '')"
else
  CHANGED_FILES=''
fi

NEED_FRONTEND_BUILD=false
NEED_BACKEND_INSTALL=false
if [ -z "$CHANGED_FILES" ] || [ "${FORCE_FRONTEND_BUILD:-false}" = true ]; then
  NEED_FRONTEND_BUILD=true
  NEED_BACKEND_INSTALL=true
  [ "${FORCE_FRONTEND_BUILD:-false}" = true ] && echo "FORCE_FRONTEND_BUILD=true — rebuilding frontend."
else
  echo "$CHANGED_FILES" | grep -q '^livekit-app/frontend/'       && NEED_FRONTEND_BUILD=true || true
  echo "$CHANGED_FILES" | grep -q '^livekit-app/backend/package' && NEED_BACKEND_INSTALL=true || true
  echo "$CHANGED_FILES" | grep -q '^livekit-app/vendor/'         && NEED_FRONTEND_BUILD=true && NEED_BACKEND_INSTALL=true || true
  echo "$CHANGED_FILES" | grep -q '^livekit-app/backend/lib/supportKit' && NEED_BACKEND_INSTALL=true || true
fi

if [ "$NEED_BACKEND_INSTALL" != true ] && [ -f "$PREV_BACKEND_DIR/package-lock.json" ]; then
  if ! cmp -s "$TEMP_DIR/livekit-app/backend/package-lock.json" "$PREV_BACKEND_DIR/package-lock.json" 2>/dev/null; then
    NEED_BACKEND_INSTALL=true
  fi
fi

# Marketing runtime output is built in the temporary checkout, never from live frontend deps.
NEED_MARKETING_PACKAGE=false
if [ -f "$TEMP_DIR/livekit-app/vendor/marketing-kit/manifest.json" ]; then
  if [ "$NEED_FRONTEND_BUILD" = true ] \
     || [ ! -f "$PREV_VENDOR_DIR/marketing-kit/runtime-artifacts.json" ] \
     || [ ! -f "$PREV_VENDOR_DIR/marketing-kit/packages/core/dist/index.cjs" ] \
     || ! cmp -s "$TEMP_DIR/livekit-app/vendor/marketing-kit/manifest.json" "$PREV_VENDOR_DIR/marketing-kit/manifest.json"; then
    NEED_MARKETING_PACKAGE=true
    NEED_FRONTEND_BUILD=true
  fi
fi

sudo mkdir -p "$RELEASES_DIR" "$SHARED_DIR/backend/uploads" "$FRONTEND_CACHE_DIR" "$BACKEND_DIR" "$FRONTEND_DIR" "$VENDOR_DIR" "$AGENT_DIR"
sudo chown ubuntu:ubuntu "$APP_DIR" "$RELEASES_DIR" "$SHARED_DIR" "$SHARED_DIR/build-cache" "$FRONTEND_CACHE_DIR" "$RELEASE_DIR" "$RELEASE_DIR/livekit-app" "$BACKEND_DIR" "$FRONTEND_DIR" "$VENDOR_DIR"
cp "$TEMP_DIR/deploy/atomic-helpers.sh" "$SHARED_DIR/atomic-helpers.sh"

# Seed shared backend files cleanly (idempotent migration from legacy paths).
if [ ! -f "$SHARED_DIR/backend/.env" ] && [ -f "$PREV_BACKEND_DIR/.env" ]; then
  sudo cp -L "$PREV_BACKEND_DIR/.env" "$SHARED_DIR/backend/.env"
  sudo chown ubuntu:ubuntu "$SHARED_DIR/backend/.env"
  sudo chmod 600 "$SHARED_DIR/backend/.env"
  echo "Seeded shared backend .env"
fi
if [ -d "$PREV_BACKEND_DIR/uploads" ] && [ ! -L "$PREV_BACKEND_DIR/uploads" ]; then
  sudo rsync -a --ignore-existing "$PREV_BACKEND_DIR/uploads/" "$SHARED_DIR/backend/uploads/"
fi
for dbfile in translations.db v2-platform.db; do
  if [ ! -f "$SHARED_DIR/backend/$dbfile" ] && [ -f "$PREV_BACKEND_DIR/$dbfile" ] && [ ! -L "$PREV_BACKEND_DIR/$dbfile" ]; then
    sudo cp "$PREV_BACKEND_DIR/$dbfile" "$SHARED_DIR/backend/$dbfile"
  fi
done
sudo chown -R ubuntu:ubuntu "$SHARED_DIR/backend"

# Ensure SUPPORT_KIT_ENABLED / MARKETING_KIT_ENABLED are on in shared .env.
if [ -f "$SHARED_DIR/backend/.env" ]; then
  sudo chmod 600 "$SHARED_DIR/backend/.env"
  if grep -q '^SUPPORT_KIT_ENABLED=' "$SHARED_DIR/backend/.env"; then
    sudo sed -i 's/^SUPPORT_KIT_ENABLED=.*/SUPPORT_KIT_ENABLED=true/' "$SHARED_DIR/backend/.env"
  else
    echo 'SUPPORT_KIT_ENABLED=true' | sudo tee -a "$SHARED_DIR/backend/.env" >/dev/null
  fi
  if grep -q '^MARKETING_KIT_ENABLED=' "$SHARED_DIR/backend/.env"; then
    sudo sed -i 's/^MARKETING_KIT_ENABLED=.*/MARKETING_KIT_ENABLED=true/' "$SHARED_DIR/backend/.env"
  else
    echo 'MARKETING_KIT_ENABLED=true' | sudo tee -a "$SHARED_DIR/backend/.env" >/dev/null
  fi
  sudo chown ubuntu:ubuntu "$SHARED_DIR/backend/.env"
  sudo chmod 600 "$SHARED_DIR/backend/.env"
fi

if [ "$NEED_FRONTEND_BUILD" = true ] || [ ! -f "$PREV_FRONTEND_DIR/index.html" ]; then
  # Vendor packages must resolve before frontend npm install (file:../vendor)
  if [ -d "$TEMP_DIR/livekit-app/vendor/support-kit/packages" ]; then
    for pkg in shared react; do
      PKG_DIR="$TEMP_DIR/livekit-app/vendor/support-kit/packages/$pkg"
      if [ -f "$PKG_DIR/package.json" ]; then
        (cd "$PKG_DIR" && npm install --omit=dev --prefer-offline --no-audit --silent)
      fi
    done
  fi
  cd "$TEMP_DIR/livekit-app/frontend"
  if [ -d "$FRONTEND_CACHE_DIR/node_modules" ] \
     && cmp -s "$FRONTEND_CACHE_DIR/package-lock.json" "$TEMP_DIR/livekit-app/frontend/package-lock.json" 2>/dev/null; then
    cp -a "$FRONTEND_CACHE_DIR/node_modules" .
  elif [ -d "$PREV_FRONTEND_DIR/node_modules" ] \
     && cmp -s "$PREV_FRONTEND_DIR/package-lock.json" "$TEMP_DIR/livekit-app/frontend/package-lock.json" 2>/dev/null; then
    cp -a "$PREV_FRONTEND_DIR/node_modules" .
  else
    npm ci --prefer-offline --no-audit --silent 2>/dev/null \
      || npm install --prefer-offline --no-audit --silent
    rm -rf "$FRONTEND_CACHE_DIR/node_modules"
    cp -a "$TEMP_DIR/livekit-app/frontend/node_modules" "$FRONTEND_CACHE_DIR/node_modules"
    cp -f "$TEMP_DIR/livekit-app/frontend/package-lock.json" "$FRONTEND_CACHE_DIR/package-lock.json"
  fi
fi

# BEGIN MARKETING_RUNTIME_PREPARE
if [ "$NEED_MARKETING_PACKAGE" = true ]; then
  node "$TEMP_DIR/deploy/prepare-marketing-runtime.mjs" build \
    "$TEMP_DIR/livekit-app/frontend" "$TEMP_DIR/marketing-runtime"
fi
# END MARKETING_RUNTIME_PREPARE

NEED_SHARED_RUNTIME=false
if [ -f "$TEMP_DIR/livekit-app/vendor/ops-sdk/manifest.json" ]; then
  if [ ! -f "$PREV_VENDOR_DIR/ops-sdk/dist/index.cjs" ] \
     || [ ! -f "$PREV_VENDOR_DIR/support-kit/packages/core/dist/index.cjs" ] \
     || ! cmp -s "$TEMP_DIR/livekit-app/vendor/ops-sdk/manifest.json" "$PREV_VENDOR_DIR/ops-sdk/manifest.json" 2>/dev/null \
     || ! cmp -s "$TEMP_DIR/livekit-app/vendor/support-kit/manifest.json" "$PREV_VENDOR_DIR/support-kit/manifest.json" 2>/dev/null; then
    NEED_SHARED_RUNTIME=true
    (
      cd "$TEMP_DIR/livekit-app/backend"
      npm ci --include=dev --prefer-offline --no-audit --silent
      npm run build:ops-sdk
      npm run build:support-kit
    )
  fi
fi

# Seed existing vendor runtime into the new release before rsync/publish.
if [ -d "$PREV_VENDOR_DIR" ]; then
  sudo rsync -a "$PREV_VENDOR_DIR/" "$VENDOR_DIR/"
fi

# ---------- Vendor (support-kit file: deps for backend + frontend build) ----------
if [ -d "$TEMP_DIR/livekit-app/vendor" ]; then
  echo "Syncing livekit-app/vendor..."
  sudo rsync -a --delete \
    --exclude 'node_modules' \
    --exclude 'marketing-kit' \
    --exclude 'ops-sdk/dist' \
    --exclude 'support-kit/packages/*/dist' \
    "$TEMP_DIR/livekit-app/vendor/" "$VENDOR_DIR/"
  sudo chown -R ubuntu:ubuntu "$VENDOR_DIR"
  # Nested file: deps resolve from each package dir when Node loads via backend/frontend symlinks
  for pkg in shared core channels react; do
    PKG_DIR="$VENDOR_DIR/support-kit/packages/$pkg"
    if [ -f "$PKG_DIR/package.json" ]; then
      echo "npm install vendor/support-kit/packages/$pkg..."
      (cd "$PKG_DIR" && npm install --omit=dev --prefer-offline --no-audit --silent)
    fi
  done
fi

if [ "$NEED_SHARED_RUNTIME" = true ]; then
  sudo rsync -a "$TEMP_DIR/livekit-app/vendor/ops-sdk/dist/" "$VENDOR_DIR/ops-sdk/dist/"
  for pkg in shared core channels react; do
    sudo rsync -a "$TEMP_DIR/livekit-app/vendor/support-kit/packages/$pkg/dist/" "$VENDOR_DIR/support-kit/packages/$pkg/dist/"
  done
fi

# BEGIN MARKETING_RUNTIME_PUBLISH
if [ "$NEED_MARKETING_PACKAGE" = true ]; then
  node "$TEMP_DIR/deploy/prepare-marketing-runtime.mjs" verify \
    "$TEMP_DIR/marketing-runtime" "$TEMP_DIR/livekit-app/vendor/marketing-kit/manifest.json"
  sudo mkdir -p "$VENDOR_DIR/marketing-kit"
  # Explicit artifact files only: preserve runtime node_modules, media and configuration.
  sudo rsync -a --files-from="$TEMP_DIR/marketing-runtime/files.txt" \
    "$TEMP_DIR/marketing-runtime/kit/" "$VENDOR_DIR/marketing-kit/"
  node "$TEMP_DIR/deploy/prepare-marketing-runtime.mjs" verify-runtime \
    "$VENDOR_DIR/marketing-kit" "$TEMP_DIR/livekit-app/vendor/marketing-kit/manifest.json"
fi
# END MARKETING_RUNTIME_PUBLISH

# ---------- Backend ----------
echo "Staging backend into $BACKEND_DIR..."
sudo rsync -a --delete \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'node_modules' \
  --exclude 'translations.db' \
  --exclude 'v2-platform.db' \
  --exclude 'uploads' \
  "$TEMP_DIR/livekit-app/backend/" "$BACKEND_DIR/"
sudo chown -R ubuntu:ubuntu "$BACKEND_DIR"

if [ "$NEED_BACKEND_INSTALL" = true ] || [ ! -d "$PREV_BACKEND_DIR/node_modules" ]; then
  echo "Backend: installing dependencies in release..."
  (cd "$BACKEND_DIR" && npm install --production --prefer-offline --no-audit --silent)
else
  echo "Backend: hardlinking unchanged node_modules from previous release..."
  cp -al "$PREV_BACKEND_DIR/node_modules" "$BACKEND_DIR/node_modules"
fi

ln -sfn "$SHARED_DIR/backend/.env" "$BACKEND_DIR/.env"
rm -rf "$BACKEND_DIR/uploads"
ln -sfn "$SHARED_DIR/backend/uploads" "$BACKEND_DIR/uploads"
for dbfile in translations.db v2-platform.db; do
  if [ -f "$SHARED_DIR/backend/$dbfile" ]; then
    ln -sfn "$SHARED_DIR/backend/$dbfile" "$BACKEND_DIR/$dbfile"
  fi
done

# ---------- Frontend ----------
if [ "$NEED_FRONTEND_BUILD" = true ] || [ ! -f "$PREV_FRONTEND_DIR/index.html" ]; then
  echo "Building frontend..."
  cd "$TEMP_DIR/livekit-app/frontend"
  export VITE_V2_ENTRY_ENABLED="${VITE_V2_ENTRY_ENABLED:-true}"
  if [ ! -d "$HOME/.cache/ms-playwright" ]; then
    echo "Installing Playwright Chromium for prerender..."
    npx playwright install chromium >/dev/null
  fi
  if [ ! -f "$HOME/.cache/ms-playwright/.deps-installed" ]; then
    echo "Installing Playwright OS dependencies (sudo)..."
    sudo npx playwright install-deps chromium >/dev/null || true
    touch "$HOME/.cache/ms-playwright/.deps-installed" 2>/dev/null || true
  fi
  npm run build --silent
  sudo rsync -a --delete "$TEMP_DIR/livekit-app/frontend/dist/" "$FRONTEND_DIR/"
  sudo chown -R ubuntu:ubuntu "$FRONTEND_DIR"
  if [ -d "$FRONTEND_DIR/assets" ]; then
    (cd "$FRONTEND_DIR/assets" && ls -1p | grep -v '/$' > "$FRONTEND_DIR/.own-assets-manifest" || true)
  fi
  carry_forward_hashed_assets "$RELEASES_DIR" "$FRONTEND_DIR" "$APP_DIR/livekit-app/frontend" 4
else
  echo "Frontend: no source changes, carrying forward previous frontend dist..."
  sudo rsync -a --exclude 'src' "$PREV_FRONTEND_DIR/" "$FRONTEND_DIR/"
  sudo chown -R ubuntu:ubuntu "$FRONTEND_DIR"
fi

# Support AI knowledge base (repo docs/support + backend/docs/support + frontend src, blocked in Nginx)
if [ -d "$TEMP_DIR/docs/support" ]; then
  sudo mkdir -p "$RELEASE_DIR/docs"
  sudo rsync -a "$TEMP_DIR/docs/support/" "$RELEASE_DIR/docs/support/"
fi
if [ -d "$TEMP_DIR/livekit-app/backend/docs/support" ]; then
  sudo mkdir -p "$BACKEND_DIR/docs"
  sudo rsync -a "$TEMP_DIR/livekit-app/backend/docs/support/" "$BACKEND_DIR/docs/support/"
fi
if [ -d "$TEMP_DIR/livekit-app/frontend/src" ]; then
  sudo rsync -a --delete "$TEMP_DIR/livekit-app/frontend/src/" "$FRONTEND_DIR/src/"
fi

# ---------- Translation Agent (self-hosted worker source + graceful drain override) ----------
if [ -d "$TEMP_DIR/livekit-app/translation-agent" ]; then
  sudo mkdir -p "$AGENT_DIR"
  sudo rsync -a --delete \
    --exclude '.env*' \
    --exclude '.venv' \
    --exclude '__pycache__' \
    --exclude '.pytest_cache' \
    "$TEMP_DIR/livekit-app/translation-agent/" "$AGENT_DIR/"
  sudo chown -R ubuntu:ubuntu "$AGENT_DIR"
fi

if systemctl list-unit-files lalia-selfhosted-agent.service >/dev/null 2>&1; then
  sudo mkdir -p /etc/systemd/system/lalia-selfhosted-agent.service.d
  printf '[Service]\nTimeoutStopSec=3600\n' | sudo tee /etc/systemd/system/lalia-selfhosted-agent.service.d/graceful-drain.conf >/dev/null
  sudo systemctl daemon-reload
fi

sudo chown -R ubuntu:ubuntu "$RELEASE_DIR"

# BEGIN MARKETING_RUNTIME_SMOKE
if [ -f "$VENDOR_DIR/marketing-kit/manifest.json" ]; then
  (cd "$BACKEND_DIR" && node -e 'const core=require("@rhule/marketing-core"); const shared=require("@rhule/marketing-shared"); if(typeof core.createMarketingKit!=="function" || !Object.keys(shared).length) throw Error("Marketing runtime import failed");')
fi
if [ -f "$VENDOR_DIR/ops-sdk/manifest.json" ]; then
  (cd "$BACKEND_DIR" && node -e 'if(typeof require("@rhule/ops-sdk").createSupportGateway!=="function" || typeof require("@quill/support-core").ensureSchema!=="function") throw Error("Shared runtime import failed");')
fi
# END MARKETING_RUNTIME_SMOKE

# ---------- Blue-Green Boot & Health Gate ----------
read -r NEXT_SLOT NEXT_PORT NEXT_PM2 PREV_PORT PREV_PM2 < <(select_inactive_slot "$UPSTREAM_CONF")
PREV_UPSTREAM_PORT="$PREV_PORT"
echo "Booting candidate slot '$NEXT_SLOT' ($NEXT_PM2 on 127.0.0.1:$NEXT_PORT)..."

pm2 delete "$NEXT_PM2" >/dev/null 2>&1 || true
cd "$BACKEND_DIR"
PORT="$NEXT_PORT" FRONTEND_URL="https://lalia.cloud" PUBLIC_FRONTEND_BASE_URL="https://lalia.cloud" \
  pm2 start "$BACKEND_DIR/server.js" --name "$NEXT_PM2" --cwd "$BACKEND_DIR" --kill-timeout 40000 --update-env
NEXT_PM2_STARTED="$NEXT_PM2"

wait_for_slot_health "$NEXT_PORT" 60 1 3
echo "Candidate slot '$NEXT_SLOT' passed 3 consecutive health checks."

# ---------- Atomic Cutover ----------
TMP_UPSTREAM="$(mktemp)"
write_upstream_conf "$TMP_UPSTREAM" "$NEXT_PORT"
sudo install -m 644 "$TMP_UPSTREAM" "$UPSTREAM_CONF"
rm -f "$TMP_UPSTREAM"

atomic_swap_symlink "$RELEASE_DIR" "$CURRENT_LINK"

if [ -f "$TEMP_DIR/deploy/nginx-staging.jarmetals.com.conf" ]; then
  echo "Updating staging nginx vhost..."
  sudo cp "$TEMP_DIR/deploy/nginx-staging.jarmetals.com.conf" "$NGINX_STAGING_DEST"
fi
if [ -f "$TEMP_DIR/deploy/nginx-lalia.cloud.conf" ]; then
  if sudo test -f /etc/letsencrypt/live/lalia.cloud/fullchain.pem; then
    echo "Updating lalia.cloud nginx vhost (apex + www cert)..."
    sudo cp "$TEMP_DIR/deploy/nginx-lalia.cloud.conf" /etc/nginx/sites-available/lalia.cloud
    sudo ln -sfn /etc/nginx/sites-available/lalia.cloud /etc/nginx/sites-enabled/lalia.cloud
  fi
fi
if sudo test -f /etc/letsencrypt/live/lalia.cloud/fullchain.pem && [ -f "$TEMP_DIR/deploy/nginx-share.jarmetals.com.conf" ]; then
  echo "Updating share.jarmetals.com redirect..."
  sudo cp "$TEMP_DIR/deploy/nginx-share.jarmetals.com.conf" /etc/nginx/sites-available/share.jarmetals.com
  sudo ln -sfn /etc/nginx/sites-available/share.jarmetals.com /etc/nginx/sites-enabled/share.jarmetals.com
fi

sudo nginx -t
sudo systemctl reload nginx
DEPLOY_CUTOVER_DONE=true
echo "Nginx reloaded cleanly — live traffic now on '$NEXT_SLOT' (port $NEXT_PORT)."

# ---------- Graceful Drain of Previous Slot & Cleanup ----------
sleep 2
if pm2 describe "$PREV_PM2" >/dev/null 2>&1; then
  echo "Draining previous slot '$PREV_PM2'..."
  pm2 delete "$PREV_PM2" || true
fi
if pm2 describe "livekit-backend-staging" >/dev/null 2>&1; then
  echo "Draining legacy 'livekit-backend-staging' process..."
  LEGACY_PID="$(pm2 pid livekit-backend-staging 2>/dev/null | head -n1 || true)"
  if [ -n "${LEGACY_PID:-}" ] && [ "${LEGACY_PID:-0}" -gt 0 ] 2>/dev/null; then
    kill -TERM "$LEGACY_PID" 2>/dev/null || true
    for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      kill -0 "$LEGACY_PID" 2>/dev/null || break
      sleep 1
    done
  fi
  pm2 delete "livekit-backend-staging" >/dev/null 2>&1 || true
fi
pm2 save >/dev/null

if systemctl is-active --quiet lalia-selfhosted-agent.service && { [ -z "$CHANGED_FILES" ] || echo "$CHANGED_FILES" | grep -q '^livekit-app/translation-agent/'; }; then
  echo "Draining & restarting lalia-selfhosted-agent.service (TimeoutStopSec=3600)..."
  sudo systemctl restart lalia-selfhosted-agent.service
fi

prune_old_releases "$RELEASES_DIR" "$CURRENT_LINK" 5
echo "Deployed $DEPLOY_BRANCH release $RELEASE_ID ($NEW_COMMIT) -> $NEXT_SLOT:$NEXT_PORT"
REMOTE

echo ""
echo "=== Atomic deploy finished ==="
echo "Active upstream & health check:"
ssh -i "$PEM_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "grep -E 'server 127\.0\.0\.1' '$UPSTREAM_CONF'; ACTIVE_PORT=\$(grep -Eo '127\.0\.0\.1:(3101|3102)' '$UPSTREAM_CONF' | head -n1 | cut -d: -f2); curl -sS -o /dev/null -w '  /api/health ('\$ACTIVE_PORT'): %{http_code}\n' http://127.0.0.1:\$ACTIVE_PORT/api/health; curl -sS -o /dev/null -w '  /api/v2/health ('\$ACTIVE_PORT'): %{http_code}\n' http://127.0.0.1:\$ACTIVE_PORT/api/v2/health; curl -sS -o /dev/null -w '  /api/v2/support/health ('\$ACTIVE_PORT'): %{http_code}\n' http://127.0.0.1:\$ACTIVE_PORT/api/v2/support/health"
