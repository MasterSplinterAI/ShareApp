# Locale path marketing (SEO)

**Pattern:** English is unprefixed (`/`, `/blog`, `/languages`). Other UI locales use path prefixes (`/es/...`, `/fr/...`, `/de/...`, `/pt/...`, `/ja/...`, `/zh-CN/...`). `/en` 301s to the unprefixed English URL.

**Generate:**

```bash
npm run build:locales
# or as part of
npm run build
```

**Blog bodies:** Until Master Content Creator / real translations land, locale blog *posts* keep English article copy, set `rel=canonical` to the English URL, and `noindex,follow`. They are omitted as `<loc>` entries from the sitemap (hreflang alternates still point at the locale URLs for the English post entry). Locale **home**, **languages**, and **blog index** are indexable with translated chrome.

**Meeting `?lang=`:** Unchanged — join/create still use query params; marketing SEO uses paths.
