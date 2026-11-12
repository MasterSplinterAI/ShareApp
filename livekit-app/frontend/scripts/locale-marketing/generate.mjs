#!/usr/bin/env node
/**
 * Generate locale-prefixed marketing HTML + hreflang + sitemap entries.
 *
 * English stays unprefixed (`/`). Prefixed locales write under `public/{locale}/`.
 * Untranslated blog bodies keep English copy with canonical → English + noindex
 * so we do not publish thin duplicate URLs in the sitemap.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_LOCALES,
  PREFIXED_LOCALES,
  ORIGIN,
  MARKETING_ROUTES,
  BLOG_SLUGS,
  absoluteUrl,
  localePath,
  hreflangTag,
  htmlLang,
} from './config.mjs';
import { stringsFor } from './strings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../../public');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHreflangBlock(enPath, { indexable = true } = {}) {
  const links = ALL_LOCALES.map((locale) => {
    const href = absoluteUrl(locale, enPath);
    return `<link rel="alternate" hreflang="${hreflangTag(locale)}" href="${href}" />`;
  });
  links.push(`<link rel="alternate" hreflang="x-default" href="${absoluteUrl('en', enPath)}" />`);
  const canonicalLocale = 'en';
  const canonical = absoluteUrl(canonicalLocale, enPath);
  // Indexable locale pages canonical to themselves; thin blog posts canonical to English.
  return { links: links.join('\n'), defaultCanonical: canonical, indexable };
}

function injectHead(html, { locale, enPath, title, description, indexable, selfCanonical }) {
  const { links } = buildHreflangBlock(enPath);
  const canonical = selfCanonical || absoluteUrl(locale === 'en' || indexable ? locale : 'en', enPath);
  const robots = indexable ? '' : '<meta name="robots" content="noindex,follow" />\n';
  const block = `${robots}<link rel="canonical" href="${canonical}" />\n${links}\n`;

  let out = html;
  out = out.replace(/<html\b([^>]*)>/i, (m, attrs) => {
    let next = attrs.replace(/\slang="[^"]*"/i, '');
    next = next.replace(/\sdata-mkt-locale="[^"]*"/i, '');
    return `<html${next} lang="${htmlLang(locale)}" data-mkt-locale="${locale}">`;
  });

  // Refresh or insert title / description
  if (title) {
    if (/<title>[^<]*<\/title>/i.test(out)) {
      out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
    } else {
      out = out.replace(/<head[^>]*>/i, (h) => `${h}\n<title>${escapeHtml(title)}</title>`);
    }
  }
  if (description) {
    if (/<meta\s+name="description"/i.test(out)) {
      out = out.replace(
        /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
        `<meta name="description" content="${escapeHtml(description)}" />`
      );
    } else {
      out = out.replace(/<head[^>]*>/i, (h) => `${h}\n<meta name="description" content="${escapeHtml(description)}" />`);
    }
  }

  // Strip prior generated SEO block markers then inject fresh
  out = out.replace(/\n?<!-- mkt-hreflang-begin -->[\s\S]*?<!-- mkt-hreflang-end -->\n?/g, '\n');
  out = out.replace(
    /<head[^>]*>/i,
    (h) => `${h}\n<!-- mkt-hreflang-begin -->\n${block}<!-- mkt-hreflang-end -->`
  );
  return out;
}

function rewriteInternalLinks(html, locale) {
  if (locale === 'en') return html;
  const prefix = `/${locale}`;
  const keepPrefix =
    /^(\/studio-assets|\/assets|\/api|\/v2|\/login|\/signup|\/demo|\/join|\/room|\/marketing|https?:|mailto:|tel:)/i;

  let out = html.replace(/href=(["'])([^"']*)\1/gi, (full, q, href) => {
    if (!href || href.startsWith('#') || keepPrefix.test(href)) return full;
    if (href === '/') return `href=${q}${prefix}/${q}`;
    if (href.startsWith('/#')) return `href=${q}${prefix}/${href.slice(1)}${q}`;
    if (href.startsWith('/blog') || href.startsWith('/languages')) {
      return `href=${q}${prefix}${href}${q}`;
    }
    return full;
  });

  // Brand marks that used href="#" should land on the locale home
  out = out.replace(
    /(<a\b[^>]*\bclass="[^"]*\bbrand\b[^"]*"[^>]*\bhref=["'])#(["'])/gi,
    `$1${prefix}/$2`
  );
  out = out.replace(
    /(<a\b[^>]*\bhref=["'])#(["'][^>]*\bclass="[^"]*\bbrand\b)/gi,
    `$1${prefix}/$2`
  );
  return out;
}

function applyChromeStrings(html, locale, route) {
  const s = stringsFor(locale);
  let out = html;

  const replacements = [
    ['Experience Lalia', s.navExperience],
    ['Why Lalia', s.navWhy],
    ['How it works', s.navHow],
    ['Pricing', s.navPricing],
    ['>Blog<', `>${s.navBlog}<`],
    ['>Languages<', `>${s.navLanguages}<`],
    ['Sign in', s.navSignIn],
    ['Try the live demo', s.navDemo],
    ['Get started', s.navGetStarted],
    ['Start free', s.navStartFree],
    ['Start talking for free', s.ctaStart],
    ['See how it feels', s.ctaSee],
    ['A SMALLER WORLD. A BIGGER CONVERSATION.', s.heroEyebrow],
    ['A world of languages.<br>One human connection.', s.footerTag.replace('. ', '.<br>')],
    ['A world of languages.', s.footerTag.split('.')[0] + '.'],
    ['One human connection.', s.footerTag.split('.').slice(1).join('.').trim()],
    ['>EXPLORE<', `>${s.explore}<`],
    ['>LET’S CONNECT<', `>${s.connect}<`],
    ['>LET&apos;S CONNECT<', `>${s.connect}<`],
    ['Supported languages — Lalia', s.titleLanguages],
    ['Every language<br><span>Lalia speaks.</span>', `${s.languagesH1Lead}<br><span>${s.languagesH1Mint}</span>`],
    [
      'Talk, read, and listen across 61 languages and regional dialects. Pick yours in the meeting. Everyone else can pick theirs.',
      s.languagesLead,
    ],
    ['Search languages', s.languagesSearch],
    ['← Home', s.backHome],
  ];

  for (const [from, to] of replacements) {
    if (!to || from === to) continue;
    out = out.split(from).join(to);
  }

  // Hero title pieces (studio-home specific)
  if (route.id === 'home') {
    out = out.replace(
      /The world is <br>one <span class="mint">conversation\.<\/span>/,
      `${s.heroTitleLead} <br>${s.heroOne} <span class="mint">${s.heroTitleMint}</span>`
    );
    // Replace the English hero description paragraph body when present.
    out = out.replace(
      /(<p class="hero-description">)[\s\S]*?(<\/p>)/,
      (_match, open, close) => `${open}${escapeHtml(s.heroDesc)}${close}`
    );
  }

  if (route.blogSlug && locale !== 'en') {
    const note = `<p class="mkt-untranslated-note" style="margin:0.75rem 0 0;font-size:0.95rem;opacity:0.85">${escapeHtml(
      s.untranslatedNote
    )}</p>`;
    if (out.includes('article-deck')) {
      out = out.replace(
        /(<p class="article-deck"[^>]*>[\s\S]*?<\/p>)/,
        `$1\n${note}`
      );
    } else if (out.includes('journal-featured') || out.includes('article-heading')) {
      out = out.replace(/<\/header>/i, `${note}</header>`);
    } else {
      out = out.replace(/<main[^>]*>/i, (m) => `${m}\n${note}`);
    }
  }

  return out;
}

function metaForRoute(route, locale) {
  const s = stringsFor(locale);
  if (route.id === 'home') return { title: s.titleHome, description: s.descHome, indexable: true };
  if (route.id === 'languages') return { title: s.titleLanguages, description: s.descLanguages, indexable: true };
  if (route.id === 'blog-index') {
    return {
      title: `${s.titleBlog} — Lalia`,
      description: s.descHome,
      indexable: true,
    };
  }
  // Blog posts: locale URL exists for switcher continuity but is noindex until translated.
  return {
    title: null, // keep English article title
    description: null,
    indexable: false,
  };
}

async function processRoute(route) {
  const srcPath = path.join(PUBLIC, route.source);
  if (!(await exists(srcPath))) {
    console.warn(`locale-marketing: skip missing ${route.source}`);
    return;
  }
  const raw = await readFile(srcPath, 'utf8');

  // Patch English source in place with hreflang (keeps content, adds SEO head)
  {
    const meta = metaForRoute(route, 'en');
    const enHtml = injectHead(raw, {
      locale: 'en',
      enPath: route.enPath,
      title: meta.title,
      description: meta.description,
      indexable: true,
      selfCanonical: absoluteUrl('en', route.enPath),
    });
    await writeFile(srcPath, enHtml, 'utf8');
  }

  for (const locale of PREFIXED_LOCALES) {
    const meta = metaForRoute(route, locale);
    let html = raw;
    html = applyChromeStrings(html, locale, route);
    html = rewriteInternalLinks(html, locale);
    html = injectHead(html, {
      locale,
      enPath: route.enPath,
      title: meta.title,
      description: meta.description,
      indexable: meta.indexable,
      selfCanonical: meta.indexable
        ? absoluteUrl(locale, route.enPath)
        : absoluteUrl('en', route.enPath),
    });

    const outPath = path.join(PUBLIC, locale, route.outFile);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, html, 'utf8');
  }
}

/** xhtml hreflang-enriched sitemap for home/languages/blog index */
function buildSitemapXmlWithXhtml() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [];

  const indexablePaths = ['/', '/languages', '/blog'];
  for (const enPath of indexablePaths) {
    for (const locale of ALL_LOCALES) {
      const loc = absoluteUrl(locale, enPath);
      const alts = ALL_LOCALES.map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${hreflangTag(l)}" href="${absoluteUrl(l, enPath)}" />`
      ).join('\n');
      const xDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${absoluteUrl('en', enPath)}" />`;
      entries.push(
        `  <url>\n    <loc>${escapeHtml(loc)}</loc>\n    <lastmod>${today}</lastmod>\n${alts}\n${xDefault}\n    <changefreq>weekly</changefreq>\n    <priority>${enPath === '/' ? (locale === 'en' ? '1.0' : '0.9') : '0.7'}</priority>\n  </url>`
      );
    }
  }

  for (const slug of BLOG_SLUGS) {
    const enPath = `/blog/${slug}`;
    const loc = absoluteUrl('en', enPath);
    const alts = ALL_LOCALES.map(
      (l) =>
        `    <xhtml:link rel="alternate" hreflang="${hreflangTag(l)}" href="${absoluteUrl(l, enPath)}" />`
    ).join('\n');
    const xDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}" />`;
    entries.push(
      `  <url>\n    <loc>${escapeHtml(loc)}</loc>\n    <lastmod>${today}</lastmod>\n${alts}\n${xDefault}\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`
    );
  }

  for (const p of ['/demo', '/v2/signup', '/terms', '/privacy']) {
    entries.push(
      `  <url>\n    <loc>${ORIGIN}${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join(
    '\n'
  )}\n</urlset>\n`;
}

async function main() {
  console.log('locale-marketing: generating prefixed locales', PREFIXED_LOCALES.join(', '));
  for (const route of MARKETING_ROUTES) {
    await processRoute(route);
    console.log(`  ✓ ${route.enPath}`);
  }

  const sitemap = buildSitemapXmlWithXhtml();
  await writeFile(path.join(PUBLIC, 'sitemap.xml'), sitemap, 'utf8');
  // Also stash for backend merge if marketing-kit owns live /sitemap.xml
  await mkdir(path.join(PUBLIC, 'marketing'), { recursive: true });
  await writeFile(path.join(PUBLIC, 'marketing/locale-sitemap-fragment.xml'), sitemap, 'utf8');
  console.log('locale-marketing: wrote public/sitemap.xml and marketing/locale-sitemap-fragment.xml');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
