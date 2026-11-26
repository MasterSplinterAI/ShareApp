#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYSTORE_PATH="${LALIA_UPLOAD_STORE_FILE:-$HOME/.android/lalia-release-key.jks}"
KEY_ALIAS="${LALIA_UPLOAD_KEY_ALIAS:-lalia}"
STORE_PASS="${LALIA_UPLOAD_STORE_PASSWORD:-}"
KEY_PASS="${LALIA_UPLOAD_KEY_PASSWORD:-}"
KEYSTORE_PROPS="$ANDROID_DIR/keystore.properties"

mkdir -p "$(dirname "$KEYSTORE_PATH")"

if [ ! -f "$KEYSTORE_PATH" ]; then
  if [ -z "$STORE_PASS" ]; then
    STORE_PASS="$(openssl rand -hex 16)"
  fi
  if [ -z "$KEY_PASS" ]; then
    KEY_PASS="$STORE_PASS"
  fi
  echo "==> Generating production release keystore at: $KEYSTORE_PATH"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE_PATH" \
    -storetype PKCS12 \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 4096 \
    -validity 10000 \
    -storepass "$STORE_PASS" \
    -keypass "$KEY_PASS" \
    -dname "CN=Lalia Cloud, OU=Mobile Engineering, O=Lalia, L=New York, ST=NY, C=US"
fi

if [ ! -f "$KEYSTORE_PROPS" ] && [ -n "$STORE_PASS" ]; then
  cat > "$KEYSTORE_PROPS" <<EOF
storeFile=$KEYSTORE_PATH
storePassword=$STORE_PASS
keyAlias=$KEY_ALIAS
keyPassword=${KEY_PASS:-$STORE_PASS}
EOF
  chmod 600 "$KEYSTORE_PROPS"
  echo "==> Wrote $KEYSTORE_PROPS (mode 600, gitignored)"
fi

if [ -f "$KEYSTORE_PROPS" ]; then
  STORE_PASS="$(grep '^storePassword=' "$KEYSTORE_PROPS" | cut -d= -f2-)"
  KEY_ALIAS="$(grep '^keyAlias=' "$KEYSTORE_PROPS" | cut -d= -f2-)"
  KEYSTORE_PATH="$(grep '^storeFile=' "$KEYSTORE_PROPS" | cut -d= -f2-)"
fi

echo "==> Release Signing Certificate Fingerprints (use SHA-256 for assetlinks.json & Play Protect Appeal):"
keytool -list -v -keystore "$KEYSTORE_PATH" -alias "$KEY_ALIAS" -storepass "$STORE_PASS" | grep -E "Owner:|Issuer:|SHA1:|SHA256:"

cd "$ANDROID_DIR"
echo "==> Building signed production release APK (assembleRelease)..."
./gradlew assembleRelease

RELEASE_APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
if [ -f "$RELEASE_APK" ]; then
  echo "==> Signed release APK ready at: $RELEASE_APK"
  keytool -printcert -jarfile "$RELEASE_APK" | head -n 15 || true
fi
