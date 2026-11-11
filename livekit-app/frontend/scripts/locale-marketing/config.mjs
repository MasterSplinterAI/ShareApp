/**
 * Marketing locale path-prefix config.
 *
 * Pattern (documented for Kenneth):
 * - English canonical URLs have NO prefix: `/`, `/blog`, `/languages`
 * - `/en` and `/en/...` 301 → unprefixed English equivalents
 * - Other UI locales live under `/{locale}/...` e.g. `/es/blog/...`
 * - Meeting join/create keep `?lang=` (app behavior, not marketing SEO)
 */

export const ORIGIN = 'https://lalia.cloud';

/** Prefixed marketing locales (English is unprefixed). */
export const PREFIXED_LOCALES = ['es', 'fr', 'de', 'pt', 'ja', 'zh-CN'];

export const ALL_LOCALES = ['en', ...PREFIXED_LOCALES];

/** BCP47 / hreflang values (zh-CN stays zh-CN). */
export function hreflangTag(locale) {
  return locale === 'zh-CN' ? 'zh-CN' : locale;
}

export function htmlLang(locale) {
  return locale === 'zh-CN' ? 'zh-Hans' : locale;
}

/** Path for a marketing page in a locale. English is unprefixed. */
export function localePath(locale, path = '/') {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (!locale || locale === 'en') return clean === '' ? '/' : clean;
  if (clean === '/') return `/${locale}/`;
  return `/${locale}${clean}`.replace(/\/+$/, '') || `/${locale}`;
}

export function absoluteUrl(locale, path = '/') {
  const p = localePath(locale, path);
  if (p === '/') return `${ORIGIN}/`;
  return `${ORIGIN}${p}`;
}

export const BLOG_SLUGS = [
  'why-phrase-level-commits-beat-word-by-word-streaming',
  'designing-bilingual-rooms-where-nobody-waits',
  'interpreter-or-live-ai-translation',
  'meetings-without-translators',
  'multilingual-meetings-made-easy-with-lalia',
];

/** Marketing routes that get localized static shells. */
export const MARKETING_ROUTES = [
  { id: 'home', enPath: '/', source: 'studio-home.html', outFile: 'index.html' },
  { id: 'languages', enPath: '/languages', source: 'languages/index.html', outFile: 'languages/index.html' },
  { id: 'blog-index', enPath: '/blog', source: 'blog/index.html', outFile: 'blog/index.html' },
  ...BLOG_SLUGS.map((slug) => ({
    id: `blog:${slug}`,
    enPath: `/blog/${slug}`,
    source: `blog/${slug}/index.html`,
    outFile: `blog/${slug}/index.html`,
    blogSlug: slug,
  })),
];
