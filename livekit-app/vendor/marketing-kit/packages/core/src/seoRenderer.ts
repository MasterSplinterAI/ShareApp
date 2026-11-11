import type { MarketingPost } from "@rhule/marketing-shared";
import type { MarketingBrandConfig } from "./adapters.js";

function escapeHtml(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "section";
}

function formatInlineMarkdown(line: string): string {
  let out = escapeHtml(line);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const safe = /^(https?:\/\/|\/|#|mailto:|\{\{)/i.test(href) ? href : "#";
    return `<a href="${safe}" class="mkt-inline-link">${label}</a>`;
  });
  return out;
}

export function renderMarkdownToHtmlAndToc(markdown: string): {
  html: string;
  toc: Array<{ id: string; text: string }>;
} {
  const lines = String(markdown || "").split(/\r?\n/);
  const htmlParts: string[] = [];
  const toc: Array<{ id: string; text: string }> = [];
  let inList: "ul" | "ol" | null = null;

  const closeList = () => {
    if (inList) {
      htmlParts.push(`</${inList}>`);
      inList = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      closeList();
      const text = h2[1].replace(/\*+/g, "").trim();
      const id = slugifyHeading(text);
      toc.push({ id, text });
      htmlParts.push(`<h2 id="${id}">${formatInlineMarkdown(text)}</h2>`);
      continue;
    }

    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      closeList();
      const text = h3[1].replace(/\*+/g, "").trim();
      const id = slugifyHeading(text);
      htmlParts.push(`<h3 id="${id}">${formatInlineMarkdown(text)}</h3>`);
      continue;
    }

    const quote = line.match(/^>\s*(.+)$/);
    if (quote) {
      closeList();
      htmlParts.push(`<blockquote class="mkt-callout">${formatInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    const ul = line.match(/^[-*•]\s+(.+)$/);
    if (ul) {
      if (inList !== "ul") {
        closeList();
        inList = "ul";
        htmlParts.push("<ul>");
      }
      htmlParts.push(`<li>${formatInlineMarkdown(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      if (inList !== "ol") {
        closeList();
        inList = "ol";
        htmlParts.push("<ol>");
      }
      htmlParts.push(`<li>${formatInlineMarkdown(ol[1])}</li>`);
      continue;
    }

    closeList();
    htmlParts.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }

  closeList();
  return { html: htmlParts.join("\n"), toc };
}

const SHARED_BLOG_CSS = `
  :root {
    --ink: #0f172a;
    --muted: #475569;
    --line: #e2e8f0;
    --bg: #ffffff;
    --surface: #f8fafc;
    --primary: #173b7a;
    --accent: #2563eb;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    background: var(--bg);
    line-height: 1.65;
  }
  .mkt-shell { max-width: 1180px; margin: 0 auto; padding: 0 24px; }
  .mkt-nav {
    position: sticky; top: 0; z-index: 40;
    background: rgba(255,255,255,0.92);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line);
  }
  .mkt-nav-inner {
    display: flex; align-items: center; justify-content: space-between;
    height: 68px; gap: 16px;
  }
  .mkt-brand {
    display: inline-flex; align-items: center; gap: 10px;
    font-family: Georgia, serif; font-size: 24px; font-weight: 700;
    color: var(--ink); text-decoration: none; letter-spacing: -0.5px;
  }
  .mkt-brand-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border-radius: 8px;
    background: var(--primary); color: #fff; font-size: 16px;
  }
  .mkt-nav-links { display: flex; align-items: center; gap: 22px; font-size: 14px; }
  .mkt-nav-links a { color: var(--muted); text-decoration: none; font-weight: 500; }
  .mkt-nav-links a:hover { color: var(--ink); }
  .mkt-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600;
    background: var(--primary); color: #fff; text-decoration: none; border: 1px solid var(--primary);
  }
  .mkt-btn-outline { background: transparent; color: var(--primary); border-color: #cbd5e1; }
  .mkt-hero {
    padding: 56px 0 36px; border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
  }
  .mkt-eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--primary); margin-bottom: 12px;
  }
  .mkt-h1 {
    font-family: Georgia, serif; font-size: clamp(32px, 4.5vw, 52px);
    line-height: 1.12; margin: 0 0 16px; letter-spacing: -0.02em;
  }
  .mkt-deck { font-size: 19px; color: var(--muted); max-width: 720px; margin: 0; }
  .mkt-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 28px; padding: 48px 0;
  }
  .mkt-card {
    display: flex; flex-direction: column; border: 1px solid var(--line);
    border-radius: 16px; overflow: hidden; background: #fff;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    text-decoration: none; color: inherit;
  }
  .mkt-card:hover { transform: translateY(-3px); box-shadow: 0 16px 32px rgba(15,23,42,0.08); }
  .mkt-card-img { width: 100%; aspect-ratio: 1200 / 630; object-fit: cover; background: #0f172a; border-bottom: 1px solid var(--line); }
  .mkt-card-body { padding: 22px; display: flex; flex-direction: column; flex: 1; }
  .mkt-card-meta { font-size: 12px; color: var(--muted); display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .mkt-card-title { font-family: Georgia, serif; font-size: 21px; font-weight: 700; line-height: 1.28; margin: 0 0 10px; color: var(--ink); }
  .mkt-card-excerpt { font-size: 14px; color: var(--muted); margin: 0 0 16px; flex: 1; }
  .mkt-card-link { font-size: 13px; font-weight: 600; color: var(--primary); }
  .mkt-article-layout {
    display: grid; grid-template-columns: minmax(0, 1fr) 300px;
    gap: 48px; padding: 40px 0 64px;
  }
  @media (max-width: 900px) {
    .mkt-article-layout { grid-template-columns: 1fr; }
    .mkt-nav-links { display: none; }
  }
  .mkt-article-cover {
    width: 100%; max-width: 980px; border-radius: 18px; overflow: hidden;
    border: 1px solid var(--line); margin: 28px 0 8px; box-shadow: 0 16px 40px rgba(15,23,42,0.1);
  }
  .mkt-article-cover img { width: 100%; display: block; height: auto; }
  .mkt-prose { font-size: 17px; color: #1e293b; }
  .mkt-prose h2 { font-family: Georgia, serif; font-size: 27px; margin: 36px 0 12px; color: var(--ink); }
  .mkt-prose h3 { font-size: 20px; margin: 26px 0 10px; color: var(--ink); }
  .mkt-prose p { margin: 0 0 18px; }
  .mkt-prose ul, .mkt-prose ol { margin: 0 0 20px; padding-left: 24px; }
  .mkt-prose li { margin-bottom: 8px; }
  .mkt-callout {
    margin: 24px 0; padding: 18px 22px; border-left: 4px solid var(--primary);
    background: var(--surface); border-radius: 0 12px 12px 0; font-weight: 500;
  }
  .mkt-aside-card {
    position: sticky; top: 92px; border: 1px solid var(--line);
    border-radius: 16px; padding: 22px; background: var(--surface);
  }
  .mkt-toc a {
    display: block; font-size: 13px; color: var(--muted);
    text-decoration: none; padding: 6px 0; border-bottom: 1px solid #f1f5f9;
  }
  .mkt-toc a:hover { color: var(--primary); }
  .mkt-faq { margin-top: 44px; padding-top: 28px; border-top: 1px solid var(--line); }
  .mkt-faq-item { margin-bottom: 18px; padding: 16px 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .mkt-faq-q { font-weight: 700; margin: 0 0 6px; font-size: 16px; }
  .mkt-faq-a { margin: 0; font-size: 15px; color: var(--muted); }
  .mkt-cta-banner {
    margin: 44px 0 16px; padding: 32px; border-radius: 20px;
    background: linear-gradient(135deg, #0c1931 0%, #173b7a 100%);
    color: #fff;
  }
  .mkt-footer { border-top: 1px solid var(--line); padding: 36px 0; font-size: 13px; color: var(--muted); background: var(--surface); }
`;

export function renderPublicBlogIndexHtml(input: {
  posts: MarketingPost[];
  brand: MarketingBrandConfig;
}): string {
  const canonical = `https://${input.brand.domain}/blog`;
  const cardsHtml = input.posts
    .map((post) => {
      const dateStr = (post.publishedAt || post.createdAt || "").slice(0, 10);
      const imgUrl = post.heroImageUrl || `/marketing/blog/${encodeURIComponent(post.slug)}/cover.png`;
      return `
        <a class="mkt-card" href="/blog/${escapeHtml(post.slug)}" data-testid="blog-card-${escapeHtml(post.slug)}">
          <img class="mkt-card-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(post.title)}" loading="lazy" />
          <div class="mkt-card-body">
            <div class="mkt-card-meta">
              <strong style="color:var(--primary)">${escapeHtml(post.kicker)}</strong>
              <span>·</span>
              <span>${escapeHtml(dateStr)}</span>
              <span>·</span>
              <span>${post.readingTimeMinutes} min read</span>
            </div>
            <h2 class="mkt-card-title">${escapeHtml(post.title)}</h2>
            <p class="mkt-card-excerpt">${escapeHtml(post.excerpt)}</p>
            <span class="mkt-card-link">Read article →</span>
          </div>
        </a>
      `;
    })
    .join("\n");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: `${input.brand.name} Journal`,
    description: input.brand.tagline,
    url: canonical,
    publisher: {
      "@type": "Organization",
      name: input.brand.name,
      url: `https://${input.brand.domain}`,
    },
    blogPost: input.posts.slice(0, 20).map((p) => ({
      "@type": "BlogPosting",
      headline: p.seoTitle || p.title,
      description: p.seoDescription || p.excerpt,
      url: `https://${input.brand.domain}/blog/${p.slug}`,
      datePublished: p.publishedAt || p.createdAt,
      dateModified: p.updatedAt,
    })),
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The ${escapeHtml(input.brand.name)} Journal — Legal Research, Verified Filings &amp; Practice Notes</title>
  <meta name="description" content="${escapeHtml(input.brand.tagline)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="The ${escapeHtml(input.brand.name)} Journal" />
  <meta property="og:description" content="${escapeHtml(input.brand.tagline)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>${SHARED_BLOG_CSS}</style>
</head>
<body>
  <header class="mkt-nav">
    <div class="mkt-shell mkt-nav-inner">
      <a class="mkt-brand" href="/" data-testid="blog-nav-brand">
        <span class="mkt-brand-badge">⚖</span>
        <span>${escapeHtml(input.brand.name)}<span style="color:#315fc4">.</span></span>
      </a>
      <nav class="mkt-nav-links" aria-label="Main navigation">
        <a href="/#how-it-works">How it works</a>
        <a href="/#situations">Situations</a>
        <a href="/#attorneys">For attorneys</a>
        <a href="/#pricing">Pricing</a>
        <a href="/blog" style="color:var(--primary);font-weight:700">Journal</a>
      </nav>
      <div style="display:flex;gap:10px;align-items:center">
        <a class="mkt-btn mkt-btn-outline" href="/auth?mode=login">Sign in</a>
        <a class="mkt-btn" href="${escapeHtml(input.brand.signupUrl)}">Get started free</a>
      </div>
    </div>
  </header>

  <main>
    <section class="mkt-hero">
      <div class="mkt-shell">
        <div class="mkt-eyebrow">The ${escapeHtml(input.brand.name)} Journal</div>
        <h1 class="mkt-h1" data-testid="blog-index-heading">Grounded legal research.<br /><span style="color:var(--primary)">Verified filings &amp; practical guides.</span></h1>
        <p class="mkt-deck">Plain-English guides for individuals and businesses facing court deadlines or contracts, plus authority-verification and drafting playbooks for solo attorneys and law firms.</p>
      </div>
    </section>

    <section class="mkt-shell">
      <div class="mkt-grid" data-testid="blog-posts-grid">
        ${cardsHtml || `<p style="color:var(--muted)">No published articles yet.</p>`}
      </div>
    </section>
  </main>

  <footer class="mkt-footer">
    <div class="mkt-shell" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px">
      <div><strong>${escapeHtml(input.brand.name)}</strong> · ${escapeHtml(input.brand.pricingSummary)}</div>
      <div>© ${new Date().getFullYear()} ${escapeHtml(input.brand.name)}. Information only, not legal advice.</div>
    </div>
  </footer>
</body>
</html>`;
}

export function renderPublicBlogPostHtml(input: {
  post: MarketingPost;
  relatedPosts: MarketingPost[];
  brand: MarketingBrandConfig;
}): string {
  const { post, brand } = input;
  const canonical = `https://${brand.domain}/blog/${post.slug}`;
  const imgUrl = post.heroImageUrl || `/marketing/blog/${encodeURIComponent(post.slug)}/cover.png`;
  const absImgUrl = imgUrl.startsWith("http") ? imgUrl : `https://${brand.domain}${imgUrl}`;
  const { html: bodyHtml, toc } = renderMarkdownToHtmlAndToc(post.bodyMarkdown);
  const dateStr = (post.publishedAt || post.createdAt || "").slice(0, 10);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    image: [absImgUrl],
    datePublished: post.publishedAt || post.createdAt,
    dateModified: post.updatedAt,
    author: {
      "@type": "Organization",
      name: post.authorName || brand.name,
    },
    publisher: {
      "@type": "Organization",
      name: brand.name,
      url: `https://${brand.domain}`,
    },
    mainEntityOfPage: canonical,
    keywords: (post.targetKeywords || []).join(", "),
  };

  const faqJsonLd =
    post.faqItems && post.faqItems.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: post.faqItems.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: f.answer,
            },
          })),
        }
      : null;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(post.seoTitle || post.title)} | ${escapeHtml(brand.name)}</title>
  <meta name="description" content="${escapeHtml(post.seoDescription || post.excerpt)}" />
  <meta name="keywords" content="${escapeHtml((post.targetKeywords || []).join(", "))}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(post.seoTitle || post.title)}" />
  <meta property="og:description" content="${escapeHtml(post.seoDescription || post.excerpt)}" />
  <meta property="og:image" content="${escapeHtml(absImgUrl)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>
  ${faqJsonLd ? `<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>` : ""}
  <style>${SHARED_BLOG_CSS}</style>
</head>
<body>
  <header class="mkt-nav">
    <div class="mkt-shell mkt-nav-inner">
      <a class="mkt-brand" href="/">
        <span class="mkt-brand-badge">⚖</span>
        <span>${escapeHtml(brand.name)}<span style="color:#315fc4">.</span></span>
      </a>
      <nav class="mkt-nav-links" aria-label="Main navigation">
        <a href="/">Home</a>
        <a href="/#situations">Situations</a>
        <a href="/#attorneys">For attorneys</a>
        <a href="/#pricing">Pricing</a>
        <a href="/blog" style="color:var(--primary);font-weight:700">Journal</a>
      </nav>
      <div style="display:flex;gap:10px;align-items:center">
        <a class="mkt-btn mkt-btn-outline" href="/blog">← All Articles</a>
        <a class="mkt-btn" href="${escapeHtml(post.ctaUrl || brand.signupUrl)}">${escapeHtml(post.ctaLabel || "Start free")}</a>
      </div>
    </div>
  </header>

  <main class="mkt-shell">
    <header style="padding-top:42px;max-width:860px">
      <div class="mkt-eyebrow">${escapeHtml(post.kicker)} · ${escapeHtml(dateStr)} · ${post.readingTimeMinutes} min read</div>
      <h1 class="mkt-h1" data-testid="blog-post-title">${escapeHtml(post.title)}</h1>
      <p class="mkt-deck">${escapeHtml(post.excerpt)}</p>
    </header>

    <figure class="mkt-article-cover">
      <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(post.title)}" data-testid="blog-post-hero-img" />
    </figure>

    <div class="mkt-article-layout">
      <article class="mkt-prose">
        ${bodyHtml}

        ${
          post.faqItems && post.faqItems.length > 0
            ? `<section class="mkt-faq">
                <h2>Frequently Asked Questions</h2>
                ${post.faqItems
                  .map(
                    (f) => `<div class="mkt-faq-item">
                      <p class="mkt-faq-q">${escapeHtml(f.question)}</p>
                      <p class="mkt-faq-a">${escapeHtml(f.answer)}</p>
                    </div>`,
                  )
                  .join("\n")}
              </section>`
            : ""
        }

        <div class="mkt-cta-banner">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#93c5fd;margin-bottom:8px">
            ${escapeHtml(brand.pricingSummary)}
          </div>
          <h3 style="font-family:Georgia,serif;font-size:28px;margin:0 0 10px;color:#fff">
            Put this guide to work on your actual documents.
          </h3>
          <p style="margin:0 0 20px;color:#cbd5e1;font-size:15px">
            Upload your court papers, lease, or contract. ${escapeHtml(brand.name)} reads the full record, checks every statute and case citation against official databases, and prepares your next step.
          </p>
          <a class="mkt-btn" style="background:#fff;color:#0f172a;border-color:#fff" href="${escapeHtml(post.ctaUrl || brand.signupUrl)}">
            ${escapeHtml(post.ctaLabel || "Start your first matter free")} →
          </a>
        </div>
      </article>

      <aside>
        <div class="mkt-aside-card">
          ${
            toc.length > 0
              ? `<div style="margin-bottom:22px">
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px">On this page</div>
                  <nav class="mkt-toc">
                    ${toc.map((t) => `<a href="#${escapeHtml(t.id)}">${escapeHtml(t.text)}</a>`).join("\n")}
                  </nav>
                </div>`
              : ""
          }
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--primary);margin-bottom:6px">
            ${escapeHtml(brand.name)} Workspace
          </div>
          <h4 style="margin:0 0 8px;font-size:16px">Start your first matter free.</h4>
          <p style="margin:0 0 14px;font-size:13px;color:var(--muted)">
            Get full legal research, uploaded-document analysis, verified citations, and a clear action plan. Pay when you're ready for documents.
          </p>
          <a class="mkt-btn" style="width:100%" href="${escapeHtml(post.ctaUrl || brand.signupUrl)}">
            ${escapeHtml(post.ctaLabel || "Get started free")}
          </a>
        </div>
      </aside>
    </div>
  </main>

  <footer class="mkt-footer">
    <div class="mkt-shell" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px">
      <div><strong>${escapeHtml(brand.name)}</strong> · <a href="/blog" style="color:var(--primary)">Back to Journal</a></div>
      <div>© ${new Date().getFullYear()} ${escapeHtml(brand.name)}. Legal information &amp; document preparation, not a law firm.</div>
    </div>
  </footer>
</body>
</html>`;
}

export function renderSitemapXml(input: {
  brand: MarketingBrandConfig;
  posts: MarketingPost[];
}): string {
  const base = `https://${input.brand.domain}`;
  const staticUrls = ["/", "/for-individuals", "/for-attorneys", "/pricing", "/blog"];
  const nowIso = new Date().toISOString().slice(0, 10);

  const entries = [
    ...staticUrls.map(
      (p) => `  <url><loc>${escapeHtml(base + p)}</loc><lastmod>${nowIso}</lastmod><changefreq>weekly</changefreq><priority>${p === "/" ? "1.0" : "0.8"}</priority></url>`,
    ),
    ...input.posts.map(
      (post) =>
        `  <url><loc>${escapeHtml(`${base}/blog/${post.slug}`)}</loc><lastmod>${escapeHtml((post.updatedAt || post.createdAt).slice(0, 10))}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`,
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>`;
}
