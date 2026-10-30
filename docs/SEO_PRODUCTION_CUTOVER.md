# SEO / SCO — production cutover checklist

Do these when `lalia.cloud` points at the production app host. Staging work is separate (see below).

## Reserved for production (do not do on staging)

1. **DNS / TLS**
   - `lalia.cloud` (+ `www` if used) → production host
   - Valid HTTPS cert for `lalia.cloud`

2. **Host hygiene**
   - 301 `share.jarmetals.com` (and any other legacy hosts) → `https://lalia.cloud$request_uri`
   - Confirm production nginx serves the Lalia frontend root and `try_files $uri $uri/ /index.html`

3. **Indexation (production only)**
   - Production must **not** send `X-Robots-Tag: noindex`
   - Confirm `https://lalia.cloud/robots.txt` allows marketing routes and disallows `/v2/app/`, `/room/`, `/join/`
   - Confirm `https://lalia.cloud/sitemap.xml` lists `/`, `/demo`, `/v2/signup`, `/terms`, `/privacy`

4. **Search consoles**
   - Google Search Console: verify `lalia.cloud`, submit sitemap
   - Bing Webmaster Tools: same
   - After cutover, request indexing for `/` and `/demo`

5. **Prerender on prod build (optional but recommended)**
   - Ensure Chromium is available for `npm run build` (Playwright) so marketing shells are written under `dist/`
   - Or run prerender in CI and deploy the resulting HTML shells

6. **Smoke checks**
   - View-source `/`: title, description, canonical `https://lalia.cloud/`, FAQ JSON-LD
   - `/demo`, `/terms`, `/privacy`, `/v2/signup`: unique titles + self-canonicals (via `SeoHead`)
   - `/join/…`, `/room/…`, `/v2/app/…`: `noindex` (meta robots)
   - OG debugger (Facebook/LinkedIn) for `/` share card

## Already handled in app / staging (do not redo at cutover)

- Per-route SEO config (`SeoHead` + `seoConfig.js`)
- FAQ schema synced to on-page FAQ; no LiveKit in user-facing copy
- Marketing code-split away from meeting room bundle
- Hero WebP + Inter subset
- Staging: `X-Robots-Tag: noindex,nofollow` + staging-only `robots.txt` Disallow-all (deploy script)

## After launch (growth / SCO)

- 3–5 pillar pages (languages, vs interpreter/transcription tools, security, use cases)
- Analytics + UTM persistence into signup (direct marketing)
- Org `sameAs` / logo in JSON-LD when social profiles exist
