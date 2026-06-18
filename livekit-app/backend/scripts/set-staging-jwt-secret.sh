#!/usr/bin/env bash
# Generate JWT_SECRET_V2, save locally (outside the repo), apply to staging .env via SSH.
# The secret is never printed to the terminal.
#
# Usage:
#   ./scripts/set-staging-jwt-secret.sh           # skip if staging already has JWT_SECRET_V2
#   ./scripts/set-staging-jwt-secret.sh --force   # replace existing value
#
# Local copy: ~/.share-app/secrets/staging-jwt-secret-v2.env (mode 600)
# Override SSH target: STAGING_SSH_HOST, STAGING_SSH_USER, STAGING_SSH_KEY, STAGING_BACKEND_ENV

set -euo pipefail

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

REMOTE_USER="${STAGING_SSH_USER:-ubuntu}"
REMOTE_HOST="${STAGING_SSH_HOST:-3.16.210.84}"
PEM_KEY="${STAGING_SSH_KEY:-$HOME/Downloads/AxisAlgo.pem}"
REMOTE_ENV="${STAGING_BACKEND_ENV:-/var/www/share-app-staging/livekit-app/backend/.env}"
PM2_NAME="${STAGING_PM2_NAME:-livekit-backend-staging}"
STAGING_HEALTH_PORT="${STAGING_HEALTH_PORT:-3101}"

LOCAL_SECRETS_DIR="${SHAREAPP_SECRETS_DIR:-$HOME/.share-app/secrets}"
LOCAL_SECRET_FILE="$LOCAL_SECRETS_DIR/staging-jwt-secret-v2.env"

WEAK_RE='^(change-me-in-production-v2|change-me|secret|replace-with-long-random-string)$'

if [ ! -f "$PEM_KEY" ]; then
  echo "Error: SSH key not found at $PEM_KEY" >&2
  echo "Set STAGING_SSH_KEY to your .pem path." >&2
  exit 1
fi

SSH=(ssh -i "$PEM_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
SCP=(scp -i "$PEM_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)

mkdir -p "$LOCAL_SECRETS_DIR"
chmod 700 "$LOCAL_SECRETS_DIR"

if [ "$FORCE" != true ] && [ -f "$LOCAL_SECRET_FILE" ]; then
  # shellcheck disable=SC1090
  source "$LOCAL_SECRET_FILE" 2>/dev/null || true
  if [ -n "${JWT_SECRET_V2:-}" ] && ! [[ "$JWT_SECRET_V2" =~ $WEAK_RE ]]; then
    echo "Local secret file already exists: $LOCAL_SECRET_FILE"
    echo "Use --force to generate a new secret (invalidates existing logins)."
    exit 0
  fi
fi

TMP_SECRET="$(mktemp)"
chmod 600 "$TMP_SECRET"
trap 'rm -f "$TMP_SECRET"' EXIT

if ! openssl rand -hex 32 >"$TMP_SECRET"; then
  echo "Failed to generate secret with openssl." >&2
  exit 1
fi

if [ -f "$LOCAL_SECRET_FILE" ]; then
  cp "$LOCAL_SECRET_FILE" "$LOCAL_SECRET_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  chmod 600 "$LOCAL_SECRET_FILE.bak."* 2>/dev/null || true
fi

{
  echo "# Parley staging — JWT_SECRET_V2"
  echo "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# Host: $REMOTE_HOST"
  echo "JWT_SECRET_V2=$(cat "$TMP_SECRET")"
} >"$LOCAL_SECRET_FILE"
chmod 600 "$LOCAL_SECRET_FILE"

echo "Saved locally: $LOCAL_SECRET_FILE (outside git — back this up securely)"

REMOTE_TMP="/tmp/parley-jwt-$$.secret"
"${SCP[@]}" "$TMP_SECRET" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_TMP" >/dev/null

REMOTE_STATUS="$(
  FORCE="$FORCE" REMOTE_ENV="$REMOTE_ENV" PM2_NAME="$PM2_NAME" REMOTE_TMP="$REMOTE_TMP" WEAK_RE="$WEAK_RE" \
    "${SSH[@]}" "$REMOTE_USER@$REMOTE_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail

cleanup() { rm -f "$REMOTE_TMP"; }
trap cleanup EXIT

if [ ! -f "$REMOTE_ENV" ]; then
  echo "MISSING_ENV"
  exit 3
fi

new_secret="$(cat "$REMOTE_TMP")"
if [ -z "$new_secret" ] || [ "${#new_secret}" -lt 32 ]; then
  echo "INVALID_SECRET"
  exit 4
fi

current=""
if grep -q '^JWT_SECRET_V2=' "$REMOTE_ENV" 2>/dev/null; then
  current="$(grep '^JWT_SECRET_V2=' "$REMOTE_ENV" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\''"]//; s/["'\''"]$//')"
fi

if [ "$FORCE" != true ] && [ -n "$current" ] && ! [[ "$current" =~ $WEAK_RE ]]; then
  echo "ALREADY_SET"
  exit 0
fi

tmp="$(mktemp)"
chmod 600 "$tmp"
cp "$REMOTE_ENV" "$tmp"

if grep -q '^JWT_SECRET_V2=' "$tmp"; then
  sed -i "s|^JWT_SECRET_V2=.*|JWT_SECRET_V2=$new_secret|" "$tmp"
else
  printf '\nJWT_SECRET_V2=%s\n' "$new_secret" >>"$tmp"
fi

chmod 600 "$tmp"
mv "$tmp" "$REMOTE_ENV"
chown ubuntu:ubuntu "$REMOTE_ENV" 2>/dev/null || true

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env >/dev/null
  pm2 save >/dev/null 2>&1 || true
fi

echo "UPDATED"
REMOTE
)"

case "$REMOTE_STATUS" in
  UPDATED)
    echo "Staging .env updated and $PM2_NAME restarted."
    echo "Existing browser sessions may need to log in again."
    ;;
  ALREADY_SET)
    echo "Staging already has JWT_SECRET_V2 — remote .env unchanged."
    echo "Local copy saved at $LOCAL_SECRET_FILE"
    echo "Use --force to rotate (logs everyone out)."
    ;;
  MISSING_ENV)
    echo "Error: remote .env not found at $REMOTE_ENV" >&2
    exit 1
    ;;
  INVALID_SECRET)
    echo "Error: generated secret failed remote validation." >&2
    exit 1
    ;;
  *)
    echo "Error: unexpected remote response." >&2
    exit 1
    ;;
esac

sleep 2
HTTP_CODE="$(
  "${SSH[@]}" "$REMOTE_USER@$REMOTE_HOST" \
    "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:${STAGING_HEALTH_PORT}/api/health 2>/dev/null || echo '000'"
)"
echo "Staging health (/api/health): HTTP $HTTP_CODE"
