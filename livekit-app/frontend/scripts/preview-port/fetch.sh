#!/bin/bash
# Download the Lalia Journal WordPress build (pages + every asset they load) into .cache/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${LALIA_JOURNAL_SRC:-$HERE/.cache}"
BASE="https://wordpress-1672957-6746326.cloudwaysapps.com"
PLUGIN="$BASE/wp-content/plugins/lalia-elementor/assets"
UA="Mozilla/5.0"

rm -rf "$SRC" && mkdir -p "$SRC/assets/fonts"
curl -sfL -A "$UA" "$BASE/" -o "$SRC/home.html"
curl -sfL -A "$UA" "$BASE/blog/" -o "$SRC/blog.html"
for slug in meetings-without-translators multilingual-meetings-made-easy-with-lalia; do
  curl -sfL -A "$UA" "$BASE/$slug/" -o "$SRC/$slug.html"
done

# Every stylesheet, script and image referenced by those pages.
cat "$SRC"/*.html \
  | grep -oE "(src|href)=['\"][^'\"]*(lalia-elementor|wp-content|wp-includes)[^'\"]*['\"]" \
  | sed -E "s/^(src|href)=['\"]//; s/['\"]$//; s/&#038;/\&/g" | sort -u \
  | while read -r url; do
      name="$(echo "$url" | sed -E 's#.*/wp-content/plugins/lalia-elementor/assets/##; s#\?.*##; s#https?://##; s#/#__#g')"
      curl -sfL -A "$UA" "$url" -o "$SRC/assets/$name"
    done

# Assets loaded at runtime by CSS (fonts) and elementor.js (globe data), plus the share card.
curl -sfL -A "$UA" "$PLUGIN/fonts/manrope.woff2" -o "$SRC/assets/fonts/manrope.woff2"
curl -sfL -A "$UA" "$PLUGIN/fonts/dm-sans.woff2" -o "$SRC/assets/fonts/dm-sans.woff2"
curl -sfL -A "$UA" "$PLUGIN/globe-points.json" -o "$SRC/assets/globe-points.json"
curl -sfL -A "$UA" "$PLUGIN/social-card.png" -o "$SRC/assets/social-card.png"
echo "Fetched into $SRC"
