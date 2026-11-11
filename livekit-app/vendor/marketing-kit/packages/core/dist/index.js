// src/adapters.ts
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve, sep } from "path";
var SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".data",
  "vendor",
  "tmp",
  ".tmp"
]);
var TEXT_EXT = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".md",
  ".mdx",
  ".json",
  ".css"
]);
function isTextFile(filePath) {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && TEXT_EXT.has(lower.slice(dot));
}
function tokenize(query) {
  return query.toLowerCase().split(/[^a-z0-9_]+/g).map((t) => t.trim()).filter((t) => t.length >= 3).slice(0, 12);
}
function walkAllowlistedFiles(absDir, out, maxFiles) {
  if (out.length >= maxFiles) return;
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= maxFiles) return;
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkAllowlistedFiles(abs, out, maxFiles);
    } else if (st.isFile() && isTextFile(abs) && st.size > 0 && st.size < 35e4) {
      out.push(abs);
    }
  }
}
function createMarketingCodebaseAdapter(opts) {
  const rootAbs = resolve(opts.root);
  const maxFiles = opts.maxFilesWalk ?? 350;
  return {
    label: opts.label || "Host Codebase",
    async search(query, limit = 6) {
      const tokens = tokenize(query);
      if (tokens.length === 0) return [];
      const files = [];
      for (const rel of opts.allowlist) {
        const abs = resolve(rootAbs, rel);
        if (!abs.startsWith(rootAbs)) continue;
        if (!existsSync(abs)) continue;
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          walkAllowlistedFiles(abs, files, maxFiles);
        } else if (st.isFile()) {
          files.push(abs);
        }
      }
      const hits = [];
      for (const f of files) {
        let content;
        try {
          content = readFileSync(f, "utf8");
        } catch {
          continue;
        }
        const lower = content.toLowerCase();
        let score = 0;
        let bestIdx = -1;
        for (const t of tokens) {
          let idx = lower.indexOf(t);
          let count = 0;
          while (idx !== -1 && count < 6) {
            score += 1;
            if (bestIdx < 0) bestIdx = idx;
            count += 1;
            idx = lower.indexOf(t, idx + t.length);
          }
        }
        if (score > 0) {
          const start = Math.max(0, bestIdx - 100);
          const snippet = content.slice(start, start + 380).replace(/\s+/g, " ").trim();
          hits.push({
            path: relative(rootAbs, f).split(sep).join("/"),
            score,
            snippet
          });
        }
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, limit);
    },
    async readFile(relPath) {
      const abs = resolve(rootAbs, relPath);
      if (!abs.startsWith(rootAbs + sep) && abs !== rootAbs) return null;
      if (!existsSync(abs)) return null;
      try {
        return readFileSync(abs, "utf8").slice(0, 24e3);
      } catch {
        return null;
      }
    }
  };
}

// src/schema.ts
var DEFAULT_MARKETING_TABLE_PREFIX = "mkt_";
function buildMarketingSchemaStatements(prefix = DEFAULT_MARKETING_TABLE_PREFIX) {
  const p = prefix;
  return [
    `
    CREATE TABLE IF NOT EXISTS ${p}posts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      kicker TEXT NOT NULL DEFAULT 'Practice Note',
      excerpt TEXT NOT NULL DEFAULT '',
      body_markdown TEXT NOT NULL DEFAULT '',
      seo_title TEXT NOT NULL DEFAULT '',
      seo_description TEXT NOT NULL DEFAULT '',
      target_keywords_json TEXT NOT NULL DEFAULT '[]',
      reading_time_minutes INTEGER NOT NULL DEFAULT 3,
      audience TEXT NOT NULL DEFAULT 'general',
      cta_label TEXT NOT NULL DEFAULT 'Start your first matter free',
      cta_url TEXT NOT NULL DEFAULT '/auth?mode=register',
      faq_items_json TEXT NOT NULL DEFAULT '[]',
      artwork_mode TEXT NOT NULL DEFAULT 'ai_illustration',
      artwork_prompt TEXT NOT NULL DEFAULT '',
      artwork_status TEXT NOT NULL DEFAULT 'draft',
      hero_image_url TEXT,
      studio_card_spec_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      source_topic TEXT NOT NULL DEFAULT '',
      generation_error TEXT,
      author_name TEXT NOT NULL DEFAULT 'LexIt Editorial',
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, slug)
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}posts_tenant_status ON ${p}posts(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}posts_tenant_created ON ${p}posts(tenant_id, created_at)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}post_revisions (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      instruction TEXT NOT NULL,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      seo_title TEXT NOT NULL,
      seo_description TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}post_revisions_post ON ${p}post_revisions(post_id, created_at)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}assets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'ai_illustration',
      prompt TEXT NOT NULL,
      custom_instruction TEXT,
      image_url TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'image/png',
      data_base64 TEXT,
      studio_card_spec_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}assets_target ON ${p}assets(target_type, target_id, created_at)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}campaigns (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      segment_id TEXT NOT NULL,
      segment_filter_json TEXT,
      goal TEXT NOT NULL DEFAULT '',
      layout TEXT NOT NULL DEFAULT 'editorial',
      subject TEXT NOT NULL,
      preheader TEXT NOT NULL DEFAULT '',
      headline TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL,
      body_markdown TEXT NOT NULL DEFAULT '',
      cta_label TEXT NOT NULL DEFAULT 'Open Workspace',
      cta_url TEXT NOT NULL DEFAULT '/cases',
      artwork_prompt TEXT NOT NULL DEFAULT '',
      artwork_status TEXT NOT NULL DEFAULT 'draft',
      artwork_mode TEXT NOT NULL DEFAULT 'ai_illustration',
      studio_card_spec_json TEXT,
      banner_image_url TEXT,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      recipient_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      opened_count INTEGER NOT NULL DEFAULT 0,
      clicked_count INTEGER NOT NULL DEFAULT 0,
      bounced_count INTEGER NOT NULL DEFAULT 0,
      unsubscribed_count INTEGER NOT NULL DEFAULT 0,
      scheduled_at TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}campaigns_tenant_created ON ${p}campaigns(tenant_id, created_at)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}campaign_recipients (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL,
      contact_name TEXT,
      provider_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      opened_at TEXT,
      clicked_at TEXT,
      bounced_at TEXT,
      unsubscribed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}campaign_recips_camp ON ${p}campaign_recipients(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}campaign_recips_msgid ON ${p}campaign_recipients(provider_message_id)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}copilot_messages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      suggested_actions_json TEXT,
      codebase_sources_json TEXT,
      created_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}copilot_tenant_created ON ${p}copilot_messages(tenant_id, created_at)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}subscribers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      source TEXT NOT NULL DEFAULT 'blog_inline',
      marketing_opt_in INTEGER NOT NULL DEFAULT 1,
      unsubscribe_token TEXT NOT NULL,
      unsubscribed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, email)
    )
    `
  ];
}
async function ensureMarketingSchema(db, tablePrefix = DEFAULT_MARKETING_TABLE_PREFIX) {
  const stmts = buildMarketingSchemaStatements(tablePrefix);
  for (const s of stmts) {
    await db.run(s);
  }
  return { tablePrefix, statements: stmts.length };
}

// src/artwork.ts
function escapeXml(raw) {
  return String(raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function wrapLines(text, maxCharsPerLine, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + " " + w).length <= maxCharsPerLine) {
      cur += " " + w;
    } else {
      lines.push(cur);
      if (lines.length >= maxLines) return lines;
      cur = w;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}
function fitText(text, maxChars) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars - 1);
  const atWord = cut.lastIndexOf(" ") > maxChars * 0.5 ? cut.slice(0, cut.lastIndexOf(" ")) : cut;
  return `${atWord.replace(/[\s,.;:·-]+$/, "")}\u2026`;
}
function wrapFitted(text, maxCharsPerLine, maxLines) {
  const lines = wrapLines(text, maxCharsPerLine, maxLines);
  const consumed = lines.join(" ").length;
  const total = String(text || "").trim().replace(/\s+/g, " ").length;
  if (lines.length && consumed < total) {
    lines[lines.length - 1] = fitText(`${lines[lines.length - 1]} ${String(text).trim().replace(/\s+/g, " ").slice(consumed + 1)}`, maxCharsPerLine);
  }
  return lines.map((l) => l.length > maxCharsPerLine ? fitText(l, maxCharsPerLine) : l);
}
function headlineLayout(title) {
  for (const fontSize of [44, 38, 32]) {
    const perLine = Math.floor(520 / (fontSize * 0.56));
    const maxLines = fontSize === 32 ? 5 : 4;
    const lines = wrapLines(title, perLine, 99);
    if (lines.length <= maxLines) return { lines, fontSize, lineHeight: Math.round(fontSize * 1.22) };
  }
  return { lines: wrapFitted(title, Math.floor(520 / (32 * 0.56)), 5), fontSize: 32, lineHeight: 39 };
}
function buildDefaultStudioCardSpec(input) {
  const lower = `${input.title} ${input.kicker || ""} ${input.customInstruction || ""}`.toLowerCase();
  const palette = lower.includes("emerald") || lower.includes("green") ? "emerald" : lower.includes("amber") || lower.includes("gold") || lower.includes("warm") ? "amber" : lower.includes("purple") || lower.includes("lalia") ? "purple" : "navy";
  if (lower.includes("cite") || lower.includes("citation") || lower.includes("sanction") || lower.includes("courtlistener")) {
    return {
      caption: `${input.brand.name} \xB7 Authority Verification`,
      docTitle: "Table of Authorities \xB7 Pre-Filing Audit",
      docHighlight: "Every case reporter & statutory citation cross-checked against CourtListener & Cornell LII.",
      docReference: "(28 U.S.C. \xA7 1927 \xB7 Fed. R. Civ. P. 11)",
      calloutBadge: "Verified on Record",
      calloutTitle: "Primary Sources Confirmed",
      calloutSubtitle: "Unmatched authorities flagged before filing",
      chipFrom: "DRAFT CITATIONS",
      chipTo: "Verified against official sources",
      palette
    };
  }
  if (lower.includes("contract") || lower.includes("redline") || lower.includes("lease") || lower.includes("agreement")) {
    return {
      caption: `${input.brand.name} \xB7 Contract Review & Redline`,
      docTitle: "Master Agreement \xB7 Risk & Fallback Audit",
      docHighlight: "Customer's aggregate liability shall not exceed fees paid in the prior 12 months.",
      docReference: "(\xA7 14.2 Limitation of Liability \xB7 Redlined)",
      calloutBadge: "Protective Clause",
      calloutTitle: "One-Sided Indemnity Flagged",
      calloutSubtitle: "Counter-proposal & fallback language ready",
      chipFrom: "UNCAPPED RISK",
      chipTo: "Balanced market standard",
      palette
    };
  }
  if (lower.includes("evict") || lower.includes("summons") || lower.includes("debt") || lower.includes("answer")) {
    return {
      caption: `${input.brand.name} \xB7 Court Response Package`,
      docTitle: "Verified Answer & Affirmative Defenses",
      docHighlight: "Response deadline calculated from service date; statutory defenses grounded in the record.",
      docReference: "(Court-Ready PDF + Editable Word .docx)",
      calloutBadge: "Court-Ready",
      calloutTitle: "Deadline & Filing Checklist Included",
      calloutSubtitle: "Plain-English step-by-step service guide",
      chipFrom: "UPLOADED SUMMONS",
      chipTo: "Filing-ready response",
      palette
    };
  }
  return {
    caption: `${input.brand.name} \xB7 ${input.kicker || "Editorial Studio"}`,
    docTitle: input.title,
    docHighlight: input.customInstruction ? input.customInstruction : "Grounded in the uploaded record with every source and statutory citation verified.",
    docReference: `(${input.brand.domain})`,
    calloutBadge: "Verified Workflow",
    calloutTitle: input.brand.name,
    calloutSubtitle: input.brand.tagline,
    chipFrom: "RAW RECORD",
    chipTo: "Verified deliverable",
    palette
  };
}
function renderEditorialSvgArtwork(input) {
  const paletteColors = {
    navy: { bg1: "#0c1931", bg2: "#173b7a", accent: "#38bdf8", pillBg: "#1e3a8a", gold: "#f59e0b" },
    emerald: { bg1: "#062c22", bg2: "#0f5132", accent: "#34d399", pillBg: "#065f46", gold: "#fbbf24" },
    amber: { bg1: "#271705", bg2: "#78350f", accent: "#fbbf24", pillBg: "#92400e", gold: "#38bdf8" },
    purple: { bg1: "#1e1035", bg2: "#4c1d95", accent: "#c084fc", pillBg: "#5b21b6", gold: "#f472b6" }
  };
  const pal = paletteColors[input.spec.palette || "navy"] || paletteColors.navy;
  const headline = headlineLayout(input.title);
  const highlightLines = wrapFitted(input.spec.docHighlight, 50, 2);
  const kickerText = fitText((input.kicker || input.brand.name).toUpperCase(), 28);
  const kickerWidth = Math.min(500, Math.round(48 + kickerText.length * 9.4));
  const badgeText = `\u2713 ${fitText(input.spec.calloutBadge.toUpperCase(), 26)}`;
  const badgeWidth = Math.min(420, Math.round(26 + badgeText.length * 7.6));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${pal.bg1}" />
      <stop offset="100%" stop-color="${pal.bg2}" />
    </linearGradient>
    <radialGradient id="glow" cx="80%" cy="20%" r="60%">
      <stop offset="0%" stop-color="${pal.accent}" stop-opacity="0.24" />
      <stop offset="100%" stop-color="${pal.bg1}" stop-opacity="0" />
    </radialGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="125%" height="125%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#020617" flood-opacity="0.45" />
    </filter>
  </defs>

  <rect width="1200" height="630" fill="url(#bgGrad)" />
  <rect width="1200" height="630" fill="url(#glow)" />

  <!-- Subtle architectural grid lines -->
  <g stroke="#ffffff" stroke-opacity="0.06" stroke-width="1">
    <line x1="72" y1="0" x2="72" y2="630" />
    <line x1="620" y1="0" x2="620" y2="630" />
    <line x1="1128" y1="0" x2="1128" y2="630" />
    <line x1="0" y1="90" x2="1200" y2="90" />
    <line x1="0" y1="540" x2="1200" y2="540" />
  </g>

  <!-- Left Editorial Column -->
  <g transform="translate(72, 108)">
    <rect x="0" y="0" width="${kickerWidth}" height="34" rx="17" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.2" />
    <circle cx="20" cy="17" r="5" fill="${pal.accent}" />
    <text x="36" y="22" fill="#e2e8f0" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" letter-spacing="1.2">
      ${escapeXml(kickerText)}
    </text>

    ${headline.lines.map(
    (line, idx) => `
    <text x="0" y="${88 + idx * headline.lineHeight}" fill="#ffffff" font-family="Georgia, 'Times New Roman', serif" font-size="${headline.fontSize}" font-weight="700">
      ${escapeXml(line)}
    </text>`
  ).join("")}

    <text x="0" y="310" fill="#cbd5e1" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="400">
      ${escapeXml(input.brand.name)} \xB7 ${escapeXml(input.brand.domain)}
    </text>

    <!-- Bottom pill chip -->
    <g transform="translate(0, 355)">
      <rect x="0" y="0" width="460" height="46" rx="12" fill="#0f172a" fill-opacity="0.72" stroke="#ffffff" stroke-opacity="0.16" />
      <text x="20" y="29" fill="${pal.accent}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">
        ${escapeXml(fitText(input.spec.chipFrom, 22))}
      </text>
      <text x="195" y="29" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600">
        \u2192  ${escapeXml(fitText(input.spec.chipTo, 30))}
      </text>
    </g>
  </g>

  <!-- Right Studio Artifact Card -->
  <g transform="translate(610, 102)" filter="url(#cardShadow)">
    <rect x="0" y="0" width="518" height="418" rx="20" fill="#ffffff" />
    <rect x="0" y="0" width="518" height="48" rx="20" fill="#f1f5f9" />
    <circle cx="24" cy="24" r="6" fill="#f87171" />
    <circle cx="44" cy="24" r="6" fill="#fbbf24" />
    <circle cx="64" cy="24" r="6" fill="#34d399" />
    <text x="88" y="29" fill="#475569" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600">
      ${escapeXml(fitText(input.spec.caption, 50))}
    </text>

    <!-- Document sheet inside card -->
    <g transform="translate(28, 72)">
      <text x="0" y="20" fill="#64748b" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" font-weight="600">
        ${escapeXml(fitText(input.spec.docTitle.toUpperCase(), 58))}
      </text>
      <rect x="0" y="36" width="410" height="8" rx="4" fill="#e2e8f0" />
      <rect x="0" y="52" width="340" height="8" rx="4" fill="#e2e8f0" />

      <!-- Highlighted legal passage box -->
      <rect x="0" y="76" width="462" height="86" rx="10" fill="#eff6ff" stroke="#93c5fd" stroke-width="1.5" />
      ${highlightLines.map(
    (l, i) => `
      <text x="16" y="${104 + i * 24}" fill="#1e3a8a" font-family="Georgia, serif" font-size="15" font-weight="600">
        ${escapeXml(l)}
      </text>`
  ).join("")}
      <text x="16" y="150" fill="#2563eb" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">
        ${escapeXml(fitText(input.spec.docReference, 60))}
      </text>

      <!-- Callout Verification Card -->
      <g transform="translate(0, 184)">
        <rect x="0" y="0" width="462" height="122" rx="14" fill="#0f172a" />
        <rect x="18" y="18" width="${badgeWidth}" height="24" rx="12" fill="${pal.gold}" fill-opacity="0.2" />
        <text x="30" y="34" fill="${pal.gold}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700">
          ${escapeXml(badgeText)}
        </text>
        <text x="18" y="68" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700">
          ${escapeXml(fitText(input.spec.calloutTitle, 40))}
        </text>
        <text x="18" y="96" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="14">
          ${escapeXml(fitText(input.spec.calloutSubtitle, 56))}
        </text>
      </g>
    </g>
  </g>
</svg>`;
  return Buffer.from(svg, "utf8");
}

// src/seoRenderer.ts
function escapeHtml(raw) {
  return String(raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function slugifyHeading(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "section";
}
function formatInlineMarkdown(line) {
  let out = escapeHtml(line);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const safe = /^(https?:\/\/|\/|#|mailto:|\{\{)/i.test(href) ? href : "#";
    return `<a href="${safe}" class="mkt-inline-link">${label}</a>`;
  });
  return out;
}
function renderMarkdownToHtmlAndToc(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const htmlParts = [];
  const toc = [];
  let inList = null;
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
var SHARED_BLOG_CSS = `
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
function renderPublicBlogIndexHtml(input) {
  const canonical = `https://${input.brand.domain}/blog`;
  const cardsHtml = input.posts.map((post) => {
    const dateStr = (post.publishedAt || post.createdAt || "").slice(0, 10);
    const imgUrl = post.heroImageUrl || `/marketing/blog/${encodeURIComponent(post.slug)}/cover.png`;
    return `
        <a class="mkt-card" href="/blog/${escapeHtml(post.slug)}" data-testid="blog-card-${escapeHtml(post.slug)}">
          <img class="mkt-card-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(post.title)}" loading="lazy" />
          <div class="mkt-card-body">
            <div class="mkt-card-meta">
              <strong style="color:var(--primary)">${escapeHtml(post.kicker)}</strong>
              <span>\xB7</span>
              <span>${escapeHtml(dateStr)}</span>
              <span>\xB7</span>
              <span>${post.readingTimeMinutes} min read</span>
            </div>
            <h2 class="mkt-card-title">${escapeHtml(post.title)}</h2>
            <p class="mkt-card-excerpt">${escapeHtml(post.excerpt)}</p>
            <span class="mkt-card-link">Read article \u2192</span>
          </div>
        </a>
      `;
  }).join("\n");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: `${input.brand.name} Journal`,
    description: input.brand.tagline,
    url: canonical,
    publisher: {
      "@type": "Organization",
      name: input.brand.name,
      url: `https://${input.brand.domain}`
    },
    blogPost: input.posts.slice(0, 20).map((p) => ({
      "@type": "BlogPosting",
      headline: p.seoTitle || p.title,
      description: p.seoDescription || p.excerpt,
      url: `https://${input.brand.domain}/blog/${p.slug}`,
      datePublished: p.publishedAt || p.createdAt,
      dateModified: p.updatedAt
    }))
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The ${escapeHtml(input.brand.name)} Journal \u2014 Legal Research, Verified Filings &amp; Practice Notes</title>
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
        <span class="mkt-brand-badge">\u2696</span>
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
      <div><strong>${escapeHtml(input.brand.name)}</strong> \xB7 ${escapeHtml(input.brand.pricingSummary)}</div>
      <div>\xA9 ${(/* @__PURE__ */ new Date()).getFullYear()} ${escapeHtml(input.brand.name)}. Information only, not legal advice.</div>
    </div>
  </footer>
</body>
</html>`;
}
function renderPublicBlogPostHtml(input) {
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
      name: post.authorName || brand.name
    },
    publisher: {
      "@type": "Organization",
      name: brand.name,
      url: `https://${brand.domain}`
    },
    mainEntityOfPage: canonical,
    keywords: (post.targetKeywords || []).join(", ")
  };
  const faqJsonLd = post.faqItems && post.faqItems.length > 0 ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: post.faqItems.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer
      }
    }))
  } : null;
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
        <span class="mkt-brand-badge">\u2696</span>
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
        <a class="mkt-btn mkt-btn-outline" href="/blog">\u2190 All Articles</a>
        <a class="mkt-btn" href="${escapeHtml(post.ctaUrl || brand.signupUrl)}">${escapeHtml(post.ctaLabel || "Start free")}</a>
      </div>
    </div>
  </header>

  <main class="mkt-shell">
    <header style="padding-top:42px;max-width:860px">
      <div class="mkt-eyebrow">${escapeHtml(post.kicker)} \xB7 ${escapeHtml(dateStr)} \xB7 ${post.readingTimeMinutes} min read</div>
      <h1 class="mkt-h1" data-testid="blog-post-title">${escapeHtml(post.title)}</h1>
      <p class="mkt-deck">${escapeHtml(post.excerpt)}</p>
    </header>

    <figure class="mkt-article-cover">
      <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(post.title)}" data-testid="blog-post-hero-img" />
    </figure>

    <div class="mkt-article-layout">
      <article class="mkt-prose">
        ${bodyHtml}

        ${post.faqItems && post.faqItems.length > 0 ? `<section class="mkt-faq">
                <h2>Frequently Asked Questions</h2>
                ${post.faqItems.map(
    (f) => `<div class="mkt-faq-item">
                      <p class="mkt-faq-q">${escapeHtml(f.question)}</p>
                      <p class="mkt-faq-a">${escapeHtml(f.answer)}</p>
                    </div>`
  ).join("\n")}
              </section>` : ""}

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
            ${escapeHtml(post.ctaLabel || "Start your first matter free")} \u2192
          </a>
        </div>
      </article>

      <aside>
        <div class="mkt-aside-card">
          ${toc.length > 0 ? `<div style="margin-bottom:22px">
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px">On this page</div>
                  <nav class="mkt-toc">
                    ${toc.map((t) => `<a href="#${escapeHtml(t.id)}">${escapeHtml(t.text)}</a>`).join("\n")}
                  </nav>
                </div>` : ""}
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
      <div><strong>${escapeHtml(brand.name)}</strong> \xB7 <a href="/blog" style="color:var(--primary)">Back to Journal</a></div>
      <div>\xA9 ${(/* @__PURE__ */ new Date()).getFullYear()} ${escapeHtml(brand.name)}. Legal information &amp; document preparation, not a law firm.</div>
    </div>
  </footer>
</body>
</html>`;
}
function renderSitemapXml(input) {
  const base = `https://${input.brand.domain}`;
  const staticUrls = ["/", "/for-individuals", "/for-attorneys", "/pricing", "/blog"];
  const nowIso2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const entries = [
    ...staticUrls.map(
      (p) => `  <url><loc>${escapeHtml(base + p)}</loc><lastmod>${nowIso2}</lastmod><changefreq>weekly</changefreq><priority>${p === "/" ? "1.0" : "0.8"}</priority></url>`
    ),
    ...input.posts.map(
      (post) => `  <url><loc>${escapeHtml(`${base}/blog/${post.slug}`)}</loc><lastmod>${escapeHtml((post.updatedAt || post.createdAt).slice(0, 10))}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`
    )
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>`;
}

// src/emailRenderer.ts
function escapeHtml2(raw) {
  return String(raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function absolutize(url, brand) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("{{") || url.startsWith("mailto:")) return url;
  return `https://${brand.domain}${url.startsWith("/") ? url : `/${url}`}`;
}
function inlineBodyStyles(html, layout, brand) {
  const font = layout === "minimal" ? "Georgia,'Times New Roman',serif" : "inherit";
  return html.replace(/href="(\/[^"]*)"/g, (_m, path) => `href="https://${brand.domain}${path}"`).replace(/ class="mkt-[a-z-]+"/g, "").replace(/<h2([^>]*)>/g, `<h2$1 style="margin:26px 0 10px;font-family:Georgia,serif;font-size:20px;line-height:1.3;color:#0f172a;">`).replace(/<h3([^>]*)>/g, `<h3$1 style="margin:20px 0 8px;font-size:16px;line-height:1.35;color:#0f172a;">`).replace(/<p>/g, `<p style="margin:0 0 14px;font-family:${font};">`).replace(/<ul>/g, `<ul style="margin:0 0 16px;padding-left:20px;">`).replace(/<ol>/g, `<ol style="margin:0 0 16px;padding-left:20px;">`).replace(/<li>/g, `<li style="margin:0 0 6px;">`).replace(/<blockquote>/g, `<blockquote style="margin:18px 0;padding:12px 16px;border-left:4px solid #cbd5e1;background:#f8fafc;color:#334155;">`).replace(/<a href=/g, `<a style="color:#1d4ed8;text-decoration:underline;" href=`);
}
function renderTableBannerHtml(input) {
  const { brand } = input;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0c1931;background-image:linear-gradient(135deg,#0c1931 0%,#173b7a 100%);">
  <tr>
    <td style="padding:36px 32px 34px;color:#ffffff;">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${escapeHtml2(brand.accentColor)};color:#0c1931;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml2(input.kicker)}</div>
      <div style="margin-top:14px;font-family:Georgia,serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">${escapeHtml2(input.title)}</div>
      ${input.subtitle ? `<div style="margin-top:10px;font-size:14px;line-height:1.5;color:#cbd5e1;">${escapeHtml2(input.subtitle)}</div>` : ""}
    </td>
  </tr>
</table>`;
}
function buildResponsiveEmailHtml(input) {
  const { brand, preheader, headline, bodyMarkdown, ctaLabel } = input;
  const layout = input.layout || "editorial";
  const { html: rawBodyHtml } = renderMarkdownToHtmlAndToc(bodyMarkdown);
  const innerBodyHtml = inlineBodyStyles(rawBodyHtml, layout, brand);
  const fullBannerUrl = input.bannerImageUrl ? absolutize(input.bannerImageUrl, brand) : "";
  const fullCtaUrl = absolutize(input.ctaUrl || "/", brand);
  const primary = escapeHtml2(brand.primaryColor);
  const bannerRow = fullBannerUrl ? `<tr>
            <td style="padding:0;background-color:#0f172a;">
              <img src="${escapeHtml2(fullBannerUrl)}" alt="${escapeHtml2(headline)}" width="600" style="width:100%;max-width:600px;height:auto;display:block;border:0;" />
            </td>
          </tr>` : `<tr><td style="padding:0;">${renderTableBannerHtml({
    brand,
    kicker: input.bannerKicker || brand.name,
    title: headline,
    subtitle: preheader
  })}</td></tr>`;
  const brandHeader = layout === "minimal" ? `<tr>
            <td style="padding:26px 32px 0;font-family:Georgia,serif;font-size:18px;font-weight:700;color:#0f172a;">
              ${escapeHtml2(brand.name)}
            </td>
          </tr>` : `<tr>
            <td style="padding:18px 28px;background-color:#0c1931;color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#ffffff;">
                    <span style="display:inline-block;padding:4px 10px;border-radius:6px;background-color:${primary};">${escapeHtml2(brand.name)}</span>
                  </td>
                  <td align="right" style="font-size:12px;color:#94a3b8;">${escapeHtml2(brand.domain)}</td>
                </tr>
              </table>
            </td>
          </tr>`;
  const ctaButton = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px ${layout === "spotlight" ? "auto" : "0"} 10px;">
                <tr>
                  <td align="center" style="border-radius:10px;background-color:${primary};">
                    <a href="${escapeHtml2(fullCtaUrl)}" style="display:inline-block;padding:${layout === "spotlight" ? "16px 34px" : "14px 26px"};font-size:${layout === "spotlight" ? "16px" : "15px"};font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml2(ctaLabel)} &rarr;</a>
                  </td>
                </tr>
              </table>`;
  const headlineHtml = layout === "spotlight" ? `<tr>
            <td align="center" style="padding:30px 32px 6px;background-color:#f8fafc;border-bottom:1px solid #e2e8f0;">
              <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:28px;line-height:1.2;color:#0f172a;">${escapeHtml2(headline)}</h1>
              ${ctaButton}
            </td>
          </tr>` : "";
  const mainCopy = `<tr>
            <td style="padding:${layout === "minimal" ? "18px 32px 24px" : "30px 28px 20px"};">
              ${layout === "spotlight" ? "" : `<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:${layout === "minimal" ? "24px" : "26px"};line-height:1.25;color:#0f172a;">${escapeHtml2(headline)}</h1>`}
              <div style="font-size:15px;line-height:1.65;color:#334155;">
                ${innerBodyHtml}
              </div>
              ${ctaButton}
            </td>
          </tr>`;
  const rows = layout === "minimal" ? [brandHeader, mainCopy] : layout === "spotlight" ? [brandHeader, bannerRow, headlineHtml, mainCopy] : [brandHeader, bannerRow, mainCopy];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml2(input.subject)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .mkt-shell { width: 100% !important; border-radius: 0 !important; }
      .mkt-pad { padding: 16px 0 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${escapeHtml2(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" class="mkt-pad" style="padding:28px 12px;">
        <table role="presentation" class="mkt-shell" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          ${rows.join("\n          ")}
          <tr>
            <td style="padding:20px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;">
              <p style="margin:0 0 6px;">Sent by <strong>${escapeHtml2(brand.name)}</strong> (${escapeHtml2(brand.domain)}).</p>
              <p style="margin:0;">You are receiving this because you have an account or subscribed to updates.
                <a href="{{unsubscribeUrl}}" style="color:#475569;text-decoration:underline;">Unsubscribe</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
function interpolateEmailVariables(raw, vars, opts = {}) {
  const esc = opts.escape !== false;
  return String(raw || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    if (v === void 0) return "";
    return esc ? escapeHtml2(v) : v;
  });
}

// src/store.ts
import { randomBytes, randomUUID } from "crypto";
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
var newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
var newToken = () => randomBytes(24).toString("base64url");
function parseJson(raw, fallback) {
  if (raw === null || raw === void 0 || raw === "") return fallback;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function slugify(raw) {
  return String(raw || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72).replace(/-+$/g, "") || "post";
}
function rowToPost(r) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    title: r.title,
    kicker: r.kicker,
    excerpt: r.excerpt,
    bodyMarkdown: r.body_markdown,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    targetKeywords: parseJson(r.target_keywords_json, []),
    readingTimeMinutes: Number(r.reading_time_minutes) || 3,
    audience: r.audience,
    ctaLabel: r.cta_label,
    ctaUrl: r.cta_url,
    faqItems: parseJson(r.faq_items_json, []),
    artworkMode: r.artwork_mode,
    artworkPrompt: r.artwork_prompt,
    artworkStatus: r.artwork_status,
    heroImageUrl: r.hero_image_url || null,
    studioCardSpec: parseJson(r.studio_card_spec_json, null),
    status: r.status,
    sourceTopic: r.source_topic || "",
    generationError: r.generation_error || null,
    authorName: r.author_name,
    publishedAt: r.published_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
function rowToCampaign(r) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    segmentId: r.segment_id,
    segmentFilter: parseJson(r.segment_filter_json, null),
    goal: r.goal,
    layout: r.layout || "editorial",
    subject: r.subject,
    preheader: r.preheader,
    headline: r.headline,
    bodyHtml: r.body_html,
    bodyMarkdown: r.body_markdown,
    ctaLabel: r.cta_label,
    ctaUrl: r.cta_url,
    artworkPrompt: r.artwork_prompt,
    artworkStatus: r.artwork_status,
    artworkMode: r.artwork_mode || "ai_illustration",
    studioCardSpec: parseJson(r.studio_card_spec_json, null),
    bannerImageUrl: r.banner_image_url || null,
    status: r.status,
    lastError: r.last_error || null,
    recipientCount: Number(r.recipient_count) || 0,
    sentCount: Number(r.sent_count) || 0,
    deliveredCount: Number(r.delivered_count) || 0,
    openedCount: Number(r.opened_count) || 0,
    clickedCount: Number(r.clicked_count) || 0,
    bouncedCount: Number(r.bounced_count) || 0,
    unsubscribedCount: Number(r.unsubscribed_count) || 0,
    scheduledAt: r.scheduled_at || null,
    sentAt: r.sent_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
function rowToAsset(r) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    targetType: r.target_type,
    targetId: r.target_id,
    mode: r.mode,
    prompt: r.prompt,
    customInstruction: r.custom_instruction || null,
    imageUrl: r.image_url,
    studioCardSpec: parseJson(r.studio_card_spec_json, null),
    status: r.status,
    createdAt: r.created_at
  };
}
function rowToMessage(r) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    role: r.role,
    content: r.content,
    suggestedActions: parseJson(r.suggested_actions_json, void 0),
    codebaseSources: parseJson(r.codebase_sources_json, void 0),
    createdAt: r.created_at
  };
}
var POST_COLUMNS = {
  slug: "slug",
  title: "title",
  kicker: "kicker",
  excerpt: "excerpt",
  bodyMarkdown: "body_markdown",
  seoTitle: "seo_title",
  seoDescription: "seo_description",
  targetKeywords: "target_keywords_json",
  readingTimeMinutes: "reading_time_minutes",
  audience: "audience",
  ctaLabel: "cta_label",
  ctaUrl: "cta_url",
  faqItems: "faq_items_json",
  artworkMode: "artwork_mode",
  artworkPrompt: "artwork_prompt",
  artworkStatus: "artwork_status",
  heroImageUrl: "hero_image_url",
  studioCardSpec: "studio_card_spec_json",
  status: "status",
  sourceTopic: "source_topic",
  generationError: "generation_error",
  authorName: "author_name",
  publishedAt: "published_at"
};
var CAMPAIGN_COLUMNS = {
  name: "name",
  segmentId: "segment_id",
  segmentFilter: "segment_filter_json",
  goal: "goal",
  layout: "layout",
  subject: "subject",
  preheader: "preheader",
  headline: "headline",
  bodyHtml: "body_html",
  bodyMarkdown: "body_markdown",
  ctaLabel: "cta_label",
  ctaUrl: "cta_url",
  artworkPrompt: "artwork_prompt",
  artworkStatus: "artwork_status",
  artworkMode: "artwork_mode",
  studioCardSpec: "studio_card_spec_json",
  bannerImageUrl: "banner_image_url",
  status: "status",
  lastError: "last_error",
  recipientCount: "recipient_count",
  sentCount: "sent_count",
  scheduledAt: "scheduled_at",
  sentAt: "sent_at"
};
var JSON_FIELDS = /* @__PURE__ */ new Set(["targetKeywords", "faqItems", "studioCardSpec", "segmentFilter"]);
function buildUpdate(map, patch) {
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(map)) {
    if (!(key in patch)) continue;
    const v = patch[key];
    sets.push(`${col} = ?`);
    params.push(JSON_FIELDS.has(key) ? v === null || v === void 0 ? null : JSON.stringify(v) : v ?? null);
  }
  return { sets, params };
}
function estimateReadingTime(markdown) {
  const words = String(markdown || "").split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words / 220));
}
var MarketingStore = class {
  constructor(db, p = "mkt_") {
    this.db = db;
    this.p = p;
  }
  tenantClause(tenantId, col = "tenant_id") {
    return tenantId === "all" ? { sql: "1=1", params: [] } : { sql: `${col} = ?`, params: [tenantId] };
  }
  // ---------- posts ----------
  async uniqueSlug(tenantId, base, excludeId) {
    let root = slugify(base);
    if (["posts", "jobs", "ideas", "generate-batch"].includes(root)) root = `${root}-guide`;
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const row = await this.db.get(
        `SELECT id FROM ${this.p}posts WHERE tenant_id = ? AND slug = ?`,
        [tenantId, candidate]
      );
      if (!row || row.id === excludeId) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }
  async createPost(tenantId, input) {
    const id = input.id || newId("post");
    const ts = nowIso();
    const slug = await this.uniqueSlug(tenantId, input.slug || input.title);
    await this.db.run(
      `INSERT INTO ${this.p}posts (id, tenant_id, slug, title, kicker, excerpt, body_markdown, seo_title, seo_description,
        target_keywords_json, reading_time_minutes, audience, cta_label, cta_url, faq_items_json, artwork_mode, artwork_prompt,
        artwork_status, hero_image_url, studio_card_spec_json, status, source_topic, generation_error, author_name, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        slug,
        input.title,
        input.kicker || "Practice Note",
        input.excerpt || "",
        input.bodyMarkdown || "",
        input.seoTitle || input.title,
        input.seoDescription || input.excerpt || "",
        JSON.stringify(input.targetKeywords || []),
        input.readingTimeMinutes || estimateReadingTime(input.bodyMarkdown || ""),
        input.audience || "general",
        input.ctaLabel || "Start your first matter free",
        input.ctaUrl || "/auth?mode=register",
        JSON.stringify(input.faqItems || []),
        input.artworkMode || "ai_illustration",
        input.artworkPrompt || "",
        input.artworkStatus || "draft",
        input.heroImageUrl || null,
        input.studioCardSpec ? JSON.stringify(input.studioCardSpec) : null,
        input.status || "draft",
        input.sourceTopic || input.title,
        input.generationError || null,
        input.authorName || "Editorial Team",
        input.publishedAt || null,
        input.createdAt || ts,
        ts
      ]
    );
    return await this.getPost(tenantId, id);
  }
  async getPost(tenantId, id) {
    const t = this.tenantClause(tenantId);
    const row = await this.db.get(`SELECT * FROM ${this.p}posts WHERE id = ? AND ${t.sql}`, [id, ...t.params]);
    return row ? rowToPost(row) : null;
  }
  async getPostBySlug(tenantId, slug) {
    const row = await this.db.get(`SELECT * FROM ${this.p}posts WHERE tenant_id = ? AND slug = ?`, [tenantId, slug]);
    return row ? rowToPost(row) : null;
  }
  async listPosts(tenantId, opts = {}) {
    const t = this.tenantClause(tenantId);
    const params = [...t.params];
    let where = t.sql;
    if (opts.status) {
      where += " AND status = ?";
      params.push(opts.status);
    } else {
      where += " AND status <> 'archived'";
    }
    params.push(Math.min(Math.max(opts.limit || 100, 1), 500));
    const rows = await this.db.all(
      `SELECT * FROM ${this.p}posts WHERE ${where} ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?`,
      params
    );
    return rows.map(rowToPost);
  }
  async listPublishedPosts(tenantId, limit = 200) {
    const rows = await this.db.all(
      `SELECT * FROM ${this.p}posts WHERE tenant_id = ? AND status = 'published' ORDER BY published_at DESC LIMIT ?`,
      [tenantId, limit]
    );
    return rows.map(rowToPost);
  }
  /** Drafts left in `generating` by a crashed or restarted process become editable drafts again. */
  async recoverStaleGenerating(updatedBefore, excludeIds = []) {
    const exclude = excludeIds.length ? ` AND id NOT IN (${excludeIds.map(() => "?").join(", ")})` : "";
    const result = await this.db.run(
      `UPDATE ${this.p}posts SET status = 'draft', generation_error = ?, updated_at = ?
       WHERE status = 'generating' AND updated_at < ?${exclude}`,
      ["Generation was interrupted. Use Regenerate to try again.", nowIso(), updatedBefore, ...excludeIds]
    );
    return result.changes;
  }
  async updatePost(tenantId, id, patch) {
    const { sets, params } = buildUpdate(POST_COLUMNS, patch);
    if (sets.length === 0) return this.getPost(tenantId, id);
    sets.push("updated_at = ?");
    params.push(nowIso());
    const t = this.tenantClause(tenantId);
    await this.db.run(`UPDATE ${this.p}posts SET ${sets.join(", ")} WHERE id = ? AND ${t.sql}`, [...params, id, ...t.params]);
    return this.getPost(tenantId, id);
  }
  async addRevision(post, instruction) {
    await this.db.run(
      `INSERT INTO ${this.p}post_revisions (id, post_id, tenant_id, instruction, title, excerpt, body_markdown, seo_title, seo_description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId("rev"), post.id, post.tenantId, instruction, post.title, post.excerpt, post.bodyMarkdown, post.seoTitle, post.seoDescription, nowIso()]
    );
  }
  async listRevisions(postId) {
    const rows = await this.db.all(
      `SELECT * FROM ${this.p}post_revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT 25`,
      [postId]
    );
    return rows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      tenantId: r.tenant_id,
      instruction: r.instruction,
      title: r.title,
      excerpt: r.excerpt,
      bodyMarkdown: r.body_markdown,
      seoTitle: r.seo_title,
      seoDescription: r.seo_description,
      createdAt: r.created_at
    }));
  }
  async getRevision(postId, revisionId) {
    const list = await this.listRevisions(postId);
    return list.find((r) => r.id === revisionId) || null;
  }
  // ---------- assets ----------
  async createAsset(input) {
    const id = input.id || newId("asset");
    await this.db.run(
      `INSERT INTO ${this.p}assets (id, tenant_id, target_type, target_id, mode, prompt, custom_instruction, image_url, content_type, data_base64, studio_card_spec_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [
        id,
        input.tenantId,
        input.targetType,
        input.targetId,
        input.mode,
        input.prompt,
        input.customInstruction || null,
        input.imageUrl,
        input.contentType,
        input.data ? input.data.toString("base64") : null,
        input.studioCardSpec ? JSON.stringify(input.studioCardSpec) : null,
        nowIso()
      ]
    );
    const row = await this.db.get(`SELECT * FROM ${this.p}assets WHERE id = ?`, [id]);
    return rowToAsset(row);
  }
  async listAssets(targetType, targetId) {
    const rows = await this.db.all(
      `SELECT id, tenant_id, target_type, target_id, mode, prompt, custom_instruction, image_url, studio_card_spec_json, status, created_at
       FROM ${this.p}assets WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT 12`,
      [targetType, targetId]
    );
    return rows.map(rowToAsset);
  }
  async getAssetBinary(id) {
    const row = await this.db.get(`SELECT content_type, data_base64 FROM ${this.p}assets WHERE id = ?`, [id]);
    if (!row || !row.data_base64) return null;
    return { contentType: row.content_type || "image/png", data: Buffer.from(String(row.data_base64), "base64") };
  }
  async approveLatestAsset(targetType, targetId) {
    const latest = await this.db.get(
      `SELECT id FROM ${this.p}assets WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT 1`,
      [targetType, targetId]
    );
    if (latest) await this.db.run(`UPDATE ${this.p}assets SET status = 'approved' WHERE id = ?`, [latest.id]);
  }
  // ---------- campaigns ----------
  async createCampaign(tenantId, input) {
    const id = newId("camp");
    const ts = nowIso();
    await this.db.run(
      `INSERT INTO ${this.p}campaigns (id, tenant_id, name, segment_id, segment_filter_json, goal, layout, subject, preheader, headline,
        body_html, body_markdown, cta_label, cta_url, artwork_prompt, artwork_status, artwork_mode, studio_card_spec_json, banner_image_url,
        status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        id,
        tenantId,
        input.name || input.subject,
        input.segmentId,
        input.segmentFilter ? JSON.stringify(input.segmentFilter) : null,
        input.goal || "",
        input.layout || "editorial",
        input.subject,
        input.preheader || "",
        input.headline || input.subject,
        input.bodyHtml || "",
        input.bodyMarkdown || "",
        input.ctaLabel || "Open your workspace",
        input.ctaUrl || "/",
        input.artworkPrompt || "",
        input.artworkStatus || "draft",
        input.artworkMode || "ai_illustration",
        input.studioCardSpec ? JSON.stringify(input.studioCardSpec) : null,
        input.bannerImageUrl || null,
        ts,
        ts
      ]
    );
    return await this.getCampaign(tenantId, id);
  }
  async getCampaign(tenantId, id) {
    const t = this.tenantClause(tenantId);
    const row = await this.db.get(`SELECT * FROM ${this.p}campaigns WHERE id = ? AND ${t.sql}`, [id, ...t.params]);
    return row ? rowToCampaign(row) : null;
  }
  async listCampaigns(tenantId, limit = 100) {
    const t = this.tenantClause(tenantId);
    const rows = await this.db.all(
      `SELECT * FROM ${this.p}campaigns WHERE ${t.sql} ORDER BY created_at DESC LIMIT ?`,
      [...t.params, limit]
    );
    return rows.map(rowToCampaign);
  }
  async listDueCampaigns() {
    const rows = await this.db.all(
      `SELECT * FROM ${this.p}campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 10`,
      [nowIso()]
    );
    return rows.map(rowToCampaign);
  }
  async updateCampaign(tenantId, id, patch) {
    const { sets, params } = buildUpdate(CAMPAIGN_COLUMNS, patch);
    if (sets.length === 0) return this.getCampaign(tenantId, id);
    sets.push("updated_at = ?");
    params.push(nowIso());
    const t = this.tenantClause(tenantId);
    await this.db.run(`UPDATE ${this.p}campaigns SET ${sets.join(", ")} WHERE id = ? AND ${t.sql}`, [...params, id, ...t.params]);
    return this.getCampaign(tenantId, id);
  }
  /** Atomically moves a campaign into `sending`; returns false when another worker already claimed it. */
  async claimCampaignForSend(id, fromStatuses) {
    const placeholders = fromStatuses.map(() => "?").join(", ");
    const res = await this.db.run(
      `UPDATE ${this.p}campaigns SET status = 'sending', updated_at = ? WHERE id = ? AND status IN (${placeholders})`,
      [nowIso(), id, ...fromStatuses]
    );
    return res.changes > 0;
  }
  async addRecipient(input) {
    const ts = nowIso();
    await this.db.run(
      `INSERT INTO ${this.p}campaign_recipients (id, campaign_id, tenant_id, email, contact_name, provider_message_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId("rcpt"), input.campaignId, input.tenantId, input.email, input.contactName || null, input.providerMessageId || null, input.status, ts, ts]
    );
  }
  async listRecipients(campaignId, limit = 200) {
    return this.db.all(
      `SELECT email, contact_name, provider_message_id, status, opened_at, clicked_at, bounced_at, unsubscribed_at, created_at
       FROM ${this.p}campaign_recipients WHERE campaign_id = ? ORDER BY created_at ASC LIMIT ?`,
      [campaignId, limit]
    );
  }
  /**
   * Applies a provider event to the recipient row and bumps the campaign counter only on the first
   * occurrence of each event type, so webhook retries stay idempotent.
   */
  async applyDeliveryEvent(providerMessageId, event) {
    const rcpt = await this.db.get(
      `SELECT id, campaign_id, status, opened_at, clicked_at, bounced_at FROM ${this.p}campaign_recipients WHERE provider_message_id = ?`,
      [providerMessageId]
    );
    if (!rcpt) return false;
    const ts = nowIso();
    const campaignCol = {
      delivered: "delivered_count",
      opened: "opened_count",
      clicked: "clicked_count",
      bounced: "bounced_count",
      complained: "unsubscribed_count"
    };
    let firstTime = false;
    if (event === "delivered") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET status = 'delivered', updated_at = ? WHERE id = ? AND status IN ('sent', 'queued')`,
        [ts, rcpt.id]
      );
      firstTime = r.changes > 0;
    } else if (event === "opened") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET opened_at = ?, updated_at = ? WHERE id = ? AND opened_at IS NULL`,
        [ts, ts, rcpt.id]
      );
      firstTime = r.changes > 0;
    } else if (event === "clicked") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET clicked_at = ?, updated_at = ? WHERE id = ? AND clicked_at IS NULL`,
        [ts, ts, rcpt.id]
      );
      firstTime = r.changes > 0;
    } else if (event === "bounced") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET status = 'bounced', bounced_at = ?, updated_at = ? WHERE id = ? AND bounced_at IS NULL`,
        [ts, ts, rcpt.id]
      );
      firstTime = r.changes > 0;
    } else if (event === "complained") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET status = 'complained', unsubscribed_at = ?, updated_at = ? WHERE id = ? AND unsubscribed_at IS NULL`,
        [ts, ts, rcpt.id]
      );
      firstTime = r.changes > 0;
    }
    if (firstTime) {
      const col = campaignCol[event];
      await this.db.run(`UPDATE ${this.p}campaigns SET ${col} = ${col} + 1, updated_at = ? WHERE id = ?`, [ts, rcpt.campaign_id]);
    }
    return firstTime;
  }
  async markRecipientUnsubscribed(campaignId, email) {
    const ts = nowIso();
    const r = await this.db.run(
      `UPDATE ${this.p}campaign_recipients SET unsubscribed_at = ?, updated_at = ? WHERE campaign_id = ? AND email = ? AND unsubscribed_at IS NULL`,
      [ts, ts, campaignId, email.trim().toLowerCase()]
    );
    if (r.changes > 0) {
      await this.db.run(`UPDATE ${this.p}campaigns SET unsubscribed_count = unsubscribed_count + 1, updated_at = ? WHERE id = ?`, [ts, campaignId]);
    }
  }
  async recipientEmailForMessage(providerMessageId) {
    const r = await this.db.get(
      `SELECT email, tenant_id FROM ${this.p}campaign_recipients WHERE provider_message_id = ?`,
      [providerMessageId]
    );
    return r ? { email: r.email, tenantId: r.tenant_id } : null;
  }
  // ---------- subscribers / suppression ----------
  async ensureSubscriber(tenantId, email, name, source, optIn = true) {
    const normalized = email.trim().toLowerCase();
    const existing = await this.db.get(
      `SELECT unsubscribe_token, unsubscribed_at, marketing_opt_in, source FROM ${this.p}subscribers WHERE tenant_id = ? AND email = ?`,
      [tenantId, normalized]
    );
    if (existing) {
      if (optIn && source !== "account" && existing.source === "account") {
        await this.db.run(`UPDATE ${this.p}subscribers SET source = ?, updated_at = ? WHERE tenant_id = ? AND email = ?`, [source, nowIso(), tenantId, normalized]);
      }
      return { token: existing.unsubscribe_token, unsubscribed: Boolean(existing.unsubscribed_at) || Number(existing.marketing_opt_in) === 0 };
    }
    const token = newToken();
    const ts = nowIso();
    await this.db.run(
      `INSERT INTO ${this.p}subscribers (id, tenant_id, email, name, source, marketing_opt_in, unsubscribe_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [newId("sub"), tenantId, normalized, name, source, optIn ? 1 : 0, token, ts, ts]
    );
    const row = await this.db.get(
      `SELECT unsubscribe_token, unsubscribed_at FROM ${this.p}subscribers WHERE tenant_id = ? AND email = ?`,
      [tenantId, normalized]
    );
    return { token: row?.unsubscribe_token || token, unsubscribed: Boolean(row?.unsubscribed_at) };
  }
  async resubscribe(tenantId, email) {
    await this.db.run(
      `UPDATE ${this.p}subscribers SET marketing_opt_in = 1, unsubscribed_at = NULL, updated_at = ? WHERE tenant_id = ? AND email = ?`,
      [nowIso(), tenantId, email.trim().toLowerCase()]
    );
  }
  async unsubscribeByToken(token) {
    const row = await this.db.get(`SELECT email, tenant_id, unsubscribed_at FROM ${this.p}subscribers WHERE unsubscribe_token = ?`, [token]);
    if (!row) return null;
    if (!row.unsubscribed_at) {
      await this.db.run(
        `UPDATE ${this.p}subscribers SET marketing_opt_in = 0, unsubscribed_at = ?, updated_at = ? WHERE unsubscribe_token = ?`,
        [nowIso(), nowIso(), token]
      );
    }
    return { email: row.email, tenantId: row.tenant_id };
  }
  async suppressEmail(tenantId, email) {
    await this.ensureSubscriber(tenantId, email, null, "account", false);
    await this.db.run(
      `UPDATE ${this.p}subscribers SET marketing_opt_in = 0, unsubscribed_at = COALESCE(unsubscribed_at, ?), updated_at = ? WHERE tenant_id = ? AND email = ?`,
      [nowIso(), nowIso(), tenantId, email.trim().toLowerCase()]
    );
  }
  async suppressedEmails(tenantId) {
    const rows = await this.db.all(
      `SELECT email FROM ${this.p}subscribers WHERE tenant_id = ? AND (marketing_opt_in = 0 OR unsubscribed_at IS NOT NULL)`,
      [tenantId]
    );
    return new Set(rows.map((r) => String(r.email).toLowerCase()));
  }
  async listBlogSubscribers(tenantId) {
    return this.db.all(
      `SELECT id, email, name, unsubscribe_token FROM ${this.p}subscribers
       WHERE tenant_id = ? AND source <> 'account' AND marketing_opt_in = 1 AND unsubscribed_at IS NULL ORDER BY created_at ASC`,
      [tenantId]
    );
  }
  // ---------- copilot ----------
  async addMessage(tenantId, role, content, extra = {}) {
    const id = newId("msg");
    await this.db.run(
      `INSERT INTO ${this.p}copilot_messages (id, tenant_id, role, content, suggested_actions_json, codebase_sources_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, role, content, extra.actions ? JSON.stringify(extra.actions) : null, extra.sources ? JSON.stringify(extra.sources) : null, nowIso()]
    );
    return { id, tenantId, role, content, suggestedActions: extra.actions, codebaseSources: extra.sources, createdAt: nowIso() };
  }
  async listMessages(tenantId, limit = 60) {
    const rows = await this.db.all(
      `SELECT * FROM ${this.p}copilot_messages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
      [tenantId, limit]
    );
    return rows.map(rowToMessage).reverse();
  }
  async clearMessages(tenantId) {
    await this.db.run(`DELETE FROM ${this.p}copilot_messages WHERE tenant_id = ?`, [tenantId]);
  }
  // ---------- analytics ----------
  async overview(tenantId) {
    const t = this.tenantClause(tenantId);
    const statusRows = await this.db.all(
      `SELECT status, COUNT(*) AS n FROM ${this.p}posts WHERE ${t.sql} GROUP BY status`,
      t.params
    );
    const posts = {};
    for (const r of statusRows) posts[String(r.status)] = Number(r.n) || 0;
    const agg = await this.db.get(
      `SELECT COUNT(*) AS campaigns, COALESCE(SUM(sent_count),0) AS sent, COALESCE(SUM(delivered_count),0) AS delivered,
          COALESCE(SUM(opened_count),0) AS opened, COALESCE(SUM(clicked_count),0) AS clicked, COALESCE(SUM(bounced_count),0) AS bounced,
          COALESCE(SUM(unsubscribed_count),0) AS unsubscribed, MAX(sent_at) AS last_sent
         FROM ${this.p}campaigns WHERE ${t.sql}`,
      t.params
    ) || {};
    const subs = await this.db.get(
      `SELECT COUNT(*) AS n FROM ${this.p}subscribers WHERE ${t.sql} AND source <> 'account' AND unsubscribed_at IS NULL`,
      t.params
    );
    const lastPub = await this.db.get(
      `SELECT MAX(published_at) AS p FROM ${this.p}posts WHERE ${t.sql} AND status = 'published'`,
      t.params
    );
    const sent = Number(agg.sent) || 0;
    const delivered = Number(agg.delivered) || 0;
    const base = delivered || sent;
    return {
      tenantId,
      posts,
      publishedPosts: posts.published || 0,
      campaigns: Number(agg.campaigns) || 0,
      emailsSent: sent,
      delivered,
      opened: Number(agg.opened) || 0,
      clicked: Number(agg.clicked) || 0,
      bounced: Number(agg.bounced) || 0,
      unsubscribed: Number(agg.unsubscribed) || 0,
      openRate: base ? Number(agg.opened) / base : 0,
      clickRate: base ? Number(agg.clicked) / base : 0,
      subscribers: Number(subs?.n) || 0,
      lastCampaignAt: agg.last_sent || null,
      lastPublishedAt: lastPub?.p || null
    };
  }
};

// src/generation.ts
function parseJsonLoose(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(text);
  } catch {
  }
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
var str = (v, max = 4e3) => typeof v === "string" ? v.trim().slice(0, max) : "";
var strArr = (v, maxItems = 12) => Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean).slice(0, maxItems) : [];
function contextBlock(ctx, hits = []) {
  const lines = [
    `PRODUCT: ${ctx.productName} (${ctx.domain}) \u2014 ${ctx.tagline}`,
    `BRAND VOICE: ${ctx.brandVoice}`,
    `PRICING / TIERS: ${ctx.pricingSummary}`,
    `CORE FEATURES:
${ctx.coreFeatures.map((f) => `- ${f}`).join("\n")}`,
    `TARGET AUDIENCES: ${ctx.targetAudiences.join("; ")}`
  ];
  if (ctx.recentCommitsOrChanges?.length) {
    lines.push(`RECENT PRODUCT CHANGES:
${ctx.recentCommitsOrChanges.slice(0, 15).map((c) => `- ${c}`).join("\n")}`);
  }
  if (ctx.supportKnowledgeGaps?.length) {
    lines.push(`UNANSWERED SUPPORT QUESTIONS (content opportunities):
${ctx.supportKnowledgeGaps.slice(0, 12).map((g) => `- ${g}`).join("\n")}`);
  }
  if (ctx.liveMetrics && Object.keys(ctx.liveMetrics).length) {
    lines.push(`LIVE METRICS: ${Object.entries(ctx.liveMetrics).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  if (ctx.codebaseHighlights?.length) {
    lines.push(`PRODUCT SURFACES:
${ctx.codebaseHighlights.slice(0, 12).map((h) => `- ${h.path}: ${h.summary}`).join("\n")}`);
  }
  if (hits.length) {
    lines.push(`RELEVANT CODE / DOCS:
${hits.map((h) => `[${h.path}] ${h.snippet}`).join("\n")}`);
  }
  return lines.join("\n\n");
}
var DEFAULT_WRITING_RULES = `Rules: Only describe product features listed in the context. Never invent statistics, testimonials, partnerships, awards, or capabilities.
Never overpromise accuracy or outcomes. Write in plain, confident, specific English with short sentences.
Avoid AI fluff ("cutting-edge", "game-changer", "unlock", "in today's fast-paced world", "elevate your experience").
For high-stakes legal/medical/finance topics, use careful wording and say when a qualified human professional is still required.`;
function writingRulesBlock(contentBrief) {
  const brief = typeof contentBrief === "string" ? contentBrief.trim() : "";
  if (!brief) return DEFAULT_WRITING_RULES;
  const max = 12e3;
  const clipped = brief.length <= max ? brief : `${brief.slice(0, 8e3)}

\u2026

${brief.slice(-3500)}`;
  return `${DEFAULT_WRITING_RULES}

CONTENT BRIEF (follow closely):
${clipped}`;
}
async function runCopilotTurn(input) {
  const system = `You are the Marketing Copilot for ${input.ctx.productName}. You know the product from its codebase, pricing, support gaps, and metrics.
Help the operator plan growth: SEO blog topics, email campaigns, positioning, and launch messaging grounded in real features.
${writingRulesBlock(input.contentBrief)}

Respond with JSON only:
{"reply": "markdown answer, concise, cite product surfaces when relevant",
 "actions": [ {"kind":"blog_batch","title":"...","description":"...","seedTopics":["..."],"audience":"individual|attorney|general","count":3}
            | {"kind":"email_campaign","title":"...","description":"...","segmentId":"one of: ${input.segmentIds.join(", ")}","campaignGoal":"...","subjectHint":"..."} ]}
Include 1-3 actions whenever the conversation contains an idea that could become content.

${contextBlock(input.ctx, input.hits)}`;
  const transcript = input.history.slice(-10).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  try {
    const raw = await input.llm.complete({
      system,
      user: `${transcript ? `${transcript}

` : ""}USER: ${input.message}`,
      temperature: 0.6
    });
    const parsed = parseJsonLoose(raw);
    if (parsed && typeof parsed.reply === "string") {
      return { reply: parsed.reply.trim(), actions: normalizeActions(parsed.actions, input.segmentIds) };
    }
    if (raw && raw.trim()) return { reply: raw.trim(), actions: fallbackActions(input.message, input.segmentIds) };
  } catch {
  }
  return {
    reply: `I couldn't reach the language model just now, so here is a starting point based on "${input.message.slice(0, 120)}". Pick an action below to generate drafts; you can refine every draft before anything is published or sent.`,
    actions: fallbackActions(input.message, input.segmentIds)
  };
}
function normalizeActions(raw, segmentIds) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw.slice(0, 4)) {
    if (!a || typeof a !== "object") continue;
    const kind = a.kind === "email_campaign" ? "email_campaign" : a.kind === "blog_batch" ? "blog_batch" : null;
    if (!kind) continue;
    const title = str(a.title, 140);
    if (!title) continue;
    if (kind === "blog_batch") {
      const topics = strArr(a.seedTopics, 12);
      out.push({
        kind,
        title,
        description: str(a.description, 400),
        seedTopics: topics.length ? topics : [title],
        audience: ["individual", "attorney", "general"].includes(a.audience) ? a.audience : "general",
        count: Math.min(Math.max(Number(a.count) || topics.length || 3, 1), 12)
      });
    } else {
      out.push({
        kind,
        title,
        description: str(a.description, 400),
        segmentId: segmentIds.includes(a.segmentId) ? a.segmentId : segmentIds[0] || "all_individuals",
        campaignGoal: str(a.campaignGoal, 400) || title,
        subjectHint: str(a.subjectHint, 140)
      });
    }
  }
  return out;
}
function fallbackActions(message, segmentIds) {
  const topic = message.replace(/\s+/g, " ").trim().slice(0, 100) || "How our product helps";
  return [
    {
      kind: "blog_batch",
      title: `Blog batch: ${topic}`,
      description: "Three SEO articles exploring this idea from different search intents.",
      seedTopics: [topic, `${topic}: a step-by-step guide`, `Common mistakes with ${topic.toLowerCase()}`],
      audience: "general",
      count: 3
    },
    {
      kind: "email_campaign",
      title: `Email: ${topic}`,
      description: "A short campaign introducing this idea with one clear call to action.",
      segmentId: segmentIds[0] || "all_individuals",
      campaignGoal: topic
    }
  ];
}
async function generateBlogIdeas(input) {
  const count = Math.min(Math.max(input.count || 6, 1), 12);
  try {
    const raw = await input.llm.complete({
      system: `You are an SEO content strategist for ${input.ctx.productName}. ${writingRulesBlock(input.contentBrief)}
Return JSON only: {"ideas":[{"title":"...","kicker":"2-3 word category","angle":"one sentence","targetKeywords":["..."],"audience":"individual|attorney|general"}]}

${contextBlock(input.ctx, input.hits)}`,
      user: `Propose ${count} blog article ideas${input.audience ? ` for the ${input.audience} audience` : ""}${input.theme ? ` around: ${input.theme}` : ""}.
Target real search intent (questions people type into Google). Avoid these existing titles: ${input.existingTitles.slice(0, 40).join(" | ") || "none"}.`,
      temperature: 0.8
    });
    const parsed = parseJsonLoose(raw);
    const ideas = (parsed?.ideas || []).map((i) => ({
      title: str(i?.title, 140),
      kicker: str(i?.kicker, 40) || "Journal",
      angle: str(i?.angle, 300),
      targetKeywords: strArr(i?.targetKeywords, 8),
      audience: ["individual", "attorney", "general"].includes(i?.audience) ? i.audience : "general"
    })).filter((i) => i.title);
    if (ideas.length) return ideas.slice(0, count);
  } catch {
  }
  const base = input.theme || input.ctx.coreFeatures[0] || input.ctx.productName;
  return Array.from({ length: count }, (_v, i) => ({
    title: [`What to know before ${base.toLowerCase()}`, `A practical checklist for ${base.toLowerCase()}`, `${base}: questions to ask first`][i % 3] + (i >= 3 ? ` (${i + 1})` : ""),
    kicker: "Journal",
    angle: `Explains ${base} in plain language and shows where ${input.ctx.productName} helps.`,
    targetKeywords: [base.toLowerCase()],
    audience: input.audience || "general"
  }));
}
var POST_JSON_SHAPE = `{"title":"H1 title","slug":"kebab-case-slug","kicker":"2-3 word category","excerpt":"1-2 sentence summary",
"seoTitle":"<= 60 chars, includes primary keyword","seoDescription":"<= 155 chars","targetKeywords":["primary","secondary",...],
"audience":"individual|attorney|general","bodyMarkdown":"500-900 words of markdown using ## and ### headings, short paragraphs, bullet lists, one > callout, 3-5 FAQ-worthy questions answered in body or faqItems, and 2-3 internal links such as [start free](/v2/signup), [live demo](/demo), or [pricing](/pricing)",
"faqItems":[{"question":"...","answer":"..."}],"ctaLabel":"...","ctaUrl":"/v2/signup","artworkPrompt":"editorial illustration brief, no text in image"}`;
function normalizePostDraft(parsed, fallbackTitle, audience) {
  if (!parsed || typeof parsed !== "object") return null;
  const title = str(parsed.title, 160);
  const body = str(parsed.bodyMarkdown, 3e4);
  if (!title || body.length < 200) return null;
  const faq = Array.isArray(parsed.faqItems) ? parsed.faqItems.map((f) => ({ question: str(f?.question, 300), answer: str(f?.answer, 1200) })).filter((f) => f.question && f.answer).slice(0, 6) : [];
  const ctaUrl = str(parsed.ctaUrl, 300);
  return {
    title,
    slug: slugify(str(parsed.slug, 90) || title),
    kicker: str(parsed.kicker, 40) || "Journal",
    excerpt: str(parsed.excerpt, 400) || body.replace(/[#>*_\-[\]()]/g, "").slice(0, 200),
    seoTitle: (str(parsed.seoTitle, 120) || title).slice(0, 70),
    seoDescription: (str(parsed.seoDescription, 300) || str(parsed.excerpt, 300)).slice(0, 160),
    targetKeywords: strArr(parsed.targetKeywords, 10),
    audience: ["individual", "attorney", "general"].includes(parsed.audience) ? parsed.audience : audience,
    bodyMarkdown: body,
    faqItems: faq,
    ctaLabel: str(parsed.ctaLabel, 60) || "Start talking for free",
    ctaUrl: /^(\/|https?:\/\/)/.test(ctaUrl) ? ctaUrl : "/v2/signup",
    artworkPrompt: str(parsed.artworkPrompt, 800) || `Editorial illustration about ${fallbackTitle}`,
    readingTimeMinutes: estimateReadingTime(body)
  };
}
function templatePostDraft(topic, ctx, audience) {
  const title = topic.length > 8 ? topic.replace(/\.$/, "") : `${topic}: a practical guide`;
  const features = ctx.coreFeatures.slice(0, 4);
  const body = `## Why this matters

Your supplier has a delay to explain. A new colleague has questions. A client wants a walkthrough. When the room speaks more than one language, clarity is the product.

## Start with one conversation

Pick a real call you already need to have. Invite the other person with a browser link. Speak in your language and let them hear theirs.

- Who needs to understand whom
- Which language each person prefers
- Whether you need captions, a summary, or both

## Where most people get stuck

Waiting for the "perfect" bilingual meeting often means the meeting never happens. A short live trial beats another week of email ping-pong.

> Live translation helps people talk today. Legal proceedings, medical discussions, and similar settings may still call for a qualified human interpreter.

## How ${ctx.productName} helps

${features.map((f) => `- ${f}`).join("\n")}

You can [start talking for free](/v2/signup), [see how it feels](/demo), or review [pricing](/pricing) first.

## Next steps

Book one call this week. Keep it short. Notice where the conversation gets easier \u2014 and where a human interpreter is still the right call.`;
  return {
    title,
    slug: slugify(title),
    kicker: "Journal",
    excerpt: `A plain-language guide to ${topic.toLowerCase()}, with a checklist you can use on your next call.`,
    seoTitle: title.slice(0, 60),
    seoDescription: `Plain-language guide to ${topic.toLowerCase()}: what to try first, common pitfalls, and how ${ctx.productName} helps.`.slice(0, 155),
    targetKeywords: [topic.toLowerCase()],
    audience,
    bodyMarkdown: body,
    faqItems: [
      { question: `Do I need a human interpreter for ${topic.toLowerCase()}?`, answer: "It depends on the stakes. Live translation is strong for everyday meetings and family calls; legal and medical settings may still need a qualified interpreter." },
      { question: `Can guests join without an account?`, answer: `Yes. Guests can join ${ctx.productName} meetings from a browser link without creating an account.` }
    ],
    ctaLabel: "Start talking for free",
    ctaUrl: "/v2/signup",
    artworkPrompt: `Calm editorial illustration representing ${topic}, people on a video call with subtle language cues, slate and blue palette, no text`,
    readingTimeMinutes: estimateReadingTime(body)
  };
}
async function generatePostDraft(input) {
  try {
    const raw = await input.llm.complete({
      system: `You are a senior content writer and SEO editor for ${input.ctx.productName}. ${writingRulesBlock(input.contentBrief)}
Write one complete, publish-ready article. Structure: hook intro, 4-6 ## sections with ### subsections where useful, a practical checklist,
a "How ${input.ctx.productName} helps" section grounded only in listed features, FAQ-ready answers, and a closing next step.
Always include seoTitle, seoDescription, slug, faqItems, and natural internal links.
Return JSON only in this shape:
${POST_JSON_SHAPE}

${contextBlock(input.ctx, input.hits)}`,
      user: `Topic: ${input.topic}
Audience: ${input.audience}${input.instruction ? `
Editor instructions: ${input.instruction}` : ""}`,
      temperature: 0.7
    });
    const draft = normalizePostDraft(parseJsonLoose(raw), input.topic, input.audience);
    if (draft) return { draft, usedFallback: false };
    return { draft: templatePostDraft(input.topic, input.ctx, input.audience), usedFallback: true, error: "Model returned an unusable draft; used the template." };
  } catch (err) {
    return { draft: templatePostDraft(input.topic, input.ctx, input.audience), usedFallback: true, error: String(err?.message || err).slice(0, 300) };
  }
}
async function rewritePost(input) {
  const { post } = input;
  if (input.sectionHeading) {
    const sections = splitSections(post.bodyMarkdown);
    const idx = sections.findIndex((s) => s.heading.toLowerCase() === input.sectionHeading.toLowerCase());
    if (idx < 0) return null;
    const raw2 = await input.llm.complete({
      system: `You edit one section of a published-quality article for ${input.ctx.productName}. ${writingRulesBlock(input.contentBrief)}
Return JSON only: {"sectionMarkdown":"the full replacement section starting with its ## heading"}`,
      user: `Article title: ${post.title}

Section to rewrite:
${sections[idx].text}

Instruction: ${input.instruction}`,
      temperature: 0.6
    });
    const parsed = parseJsonLoose(raw2);
    let replacement = str(parsed?.sectionMarkdown, 12e3);
    if (!replacement) return null;
    if (!/^##\s/.test(replacement)) replacement = `## ${sections[idx].heading}

${replacement}`;
    sections[idx] = { ...sections[idx], text: replacement };
    const body = sections.map((s) => s.text.trim()).join("\n\n");
    return { bodyMarkdown: body, readingTimeMinutes: estimateReadingTime(body) };
  }
  const raw = await input.llm.complete({
    system: `You revise articles for ${input.ctx.productName}. ${writingRulesBlock(input.contentBrief)}
Apply the editor instruction to the article and return the full revised article as JSON only:
${POST_JSON_SHAPE}

${contextBlock(input.ctx)}`,
    user: `Editor instruction: ${input.instruction}

Current article JSON:
${JSON.stringify({
      title: post.title,
      kicker: post.kicker,
      excerpt: post.excerpt,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      targetKeywords: post.targetKeywords,
      audience: post.audience,
      bodyMarkdown: post.bodyMarkdown,
      faqItems: post.faqItems,
      ctaLabel: post.ctaLabel,
      ctaUrl: post.ctaUrl,
      artworkPrompt: post.artworkPrompt
    })}`,
    temperature: 0.6
  });
  const draft = normalizePostDraft(parseJsonLoose(raw), post.title, post.audience);
  if (!draft) return null;
  const { slug: _slug, ...rest } = draft;
  return rest;
}
function splitSections(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const out = [];
  let current = { heading: "", lines: [] };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      if (current.lines.length) out.push({ heading: current.heading, text: current.lines.join("\n") });
      current = { heading: m[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length) out.push({ heading: current.heading, text: current.lines.join("\n") });
  return out;
}
var EMAIL_VARS_HELP = `Personalization variables you may use verbatim: {{firstName}}, {{matterTitle}}, {{proposedDocsList}}, {{unlockUrl}}.
Only use {{matterTitle}}, {{proposedDocsList}} and {{unlockUrl}} for the free_matter_locked segment.`;
async function generateEmailIdeas(input) {
  try {
    const raw = await input.llm.complete({
      system: `You are a lifecycle email strategist for ${input.ctx.productName}. ${writingRulesBlock(input.contentBrief)}
Return JSON only: {"ideas":[{"name":"internal campaign name","subject":"subject line <= 60 chars","angle":"one sentence"}]}

${contextBlock(input.ctx)}`,
      user: `Segment: ${input.segmentLabel} (${input.segmentId}).${input.goal ? ` Goal: ${input.goal}.` : ""} Propose 5 campaign ideas.`,
      temperature: 0.8
    });
    const parsed = parseJsonLoose(raw);
    const ideas = (parsed?.ideas || []).map((i) => ({ name: str(i?.name, 120), subject: str(i?.subject, 120), angle: str(i?.angle, 300), segmentId: input.segmentId })).filter((i) => i.subject);
    if (ideas.length) return ideas.slice(0, 6);
  } catch {
  }
  return [
    { name: `${input.segmentLabel}: feature spotlight`, subject: `A clearer way to talk across languages`, angle: "Spotlight one core feature with a single clear CTA.", segmentId: input.segmentId },
    { name: `${input.segmentLabel}: how-to`, subject: `3 tips before your next bilingual call`, angle: "Useful checklist that builds trust before asking for action.", segmentId: input.segmentId }
  ];
}
function templateEmailDraft(input) {
  if (input.segmentId === "free_matter_locked") {
    return {
      name: "Unlock your matter documents",
      subject: "Your documents for {{matterTitle}} are ready to unlock",
      preheader: "Pick up where you left off \u2014 your research is saved.",
      headline: "Your next documents are one step away",
      bodyMarkdown: `Hi {{firstName}},

You've already done the hard part on **{{matterTitle}}**: the facts are organized and the research is saved.

Lex has proposed these documents for your matter:

{{proposedDocsList}}

Unlock this matter once to draft, revise, and download them.`,
      ctaLabel: "Unlock my documents",
      ctaUrl: "{{unlockUrl}}",
      artworkPrompt: "Editorial illustration of a neatly organized legal folder being unlocked, navy and amber, no text",
      bannerKicker: "Your matter"
    };
  }
  return {
    name: input.goal.slice(0, 80) || `${input.ctx.productName} update`,
    subject: `${input.goal.slice(0, 50) || `What's new in ${input.ctx.productName}`}`,
    preheader: input.ctx.tagline,
    headline: input.goal.slice(0, 90) || `What's new in ${input.ctx.productName}`,
    bodyMarkdown: `Hi {{firstName}},

${input.ctx.tagline}

${input.ctx.coreFeatures.slice(0, 3).map((f) => `- ${f}`).join("\n")}

Reply to this email if you have questions \u2014 a real person reads every reply.`,
    ctaLabel: "Start a free meeting",
    ctaUrl: input.ctx.domain ? `https://${input.ctx.domain}/v2/signup` : "/v2/signup",
    artworkPrompt: `Editorial illustration for ${input.goal || input.ctx.productName}, slate and blue palette, no text`,
    bannerKicker: input.ctx.productName
  };
}
var EMAIL_JSON_SHAPE = `{"name":"internal name","subject":"<= 60 chars","preheader":"<= 100 chars","headline":"<= 70 chars",
"bodyMarkdown":"120-260 words of markdown: greeting with {{firstName}}, short paragraphs, optional bullet list","ctaLabel":"2-4 words",
"ctaUrl":"absolute or root-relative URL","artworkPrompt":"banner illustration brief, no text in image","bannerKicker":"1-3 words"}`;
function normalizeEmailDraft(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const subject = str(parsed.subject, 140);
  const body = str(parsed.bodyMarkdown, 8e3);
  if (!subject || body.length < 40) return null;
  const ctaUrl = str(parsed.ctaUrl, 400);
  return {
    name: str(parsed.name, 140) || subject,
    subject,
    preheader: str(parsed.preheader, 160),
    headline: str(parsed.headline, 140) || subject,
    bodyMarkdown: body,
    ctaLabel: str(parsed.ctaLabel, 50) || "Learn more",
    ctaUrl: /^(\/|https?:\/\/|\{\{)/.test(ctaUrl) ? ctaUrl : "/",
    artworkPrompt: str(parsed.artworkPrompt, 800),
    bannerKicker: str(parsed.bannerKicker, 40)
  };
}
async function generateEmailDraft(input) {
  try {
    const raw = await input.llm.complete({
      system: `You are a lifecycle email copywriter for ${input.ctx.productName}. ${writingRulesBlock(input.contentBrief)}
${EMAIL_VARS_HELP}
Return JSON only: ${EMAIL_JSON_SHAPE}

${contextBlock(input.ctx, input.hits)}`,
      user: `Segment: ${input.segmentLabel} (${input.segmentId})
Goal: ${input.goal}${input.instruction ? `
Instructions: ${input.instruction}` : ""}`,
      temperature: 0.7
    });
    const draft = normalizeEmailDraft(parseJsonLoose(raw));
    if (draft) return { draft, usedFallback: false };
  } catch {
  }
  return { draft: templateEmailDraft(input), usedFallback: true };
}
async function refineEmailCopy(input) {
  const raw = await input.llm.complete({
    system: `You revise marketing emails for ${input.ctx.productName}. ${writingRulesBlock(input.contentBrief)}
${EMAIL_VARS_HELP}
Apply the instruction and return the full revised email as JSON only: ${EMAIL_JSON_SHAPE}`,
    user: `Segment: ${input.segmentId}
Instruction: ${input.instruction}

Current email JSON:
${JSON.stringify(input.current)}`,
    temperature: 0.6
  });
  return normalizeEmailDraft(parseJsonLoose(raw));
}
function layoutFromInstruction(instruction, current) {
  const lower = instruction.toLowerCase();
  if (/\b(minimal|plain|letter|text[- ]only|personal)\b/.test(lower)) return "minimal";
  if (/\b(spotlight|bold|visual|hero|centered|centred|big)\b/.test(lower)) return "spotlight";
  if (/\b(editorial|classic|standard|newsletter)\b/.test(lower)) return "editorial";
  return current;
}

// src/router.ts
import { createHmac, timingSafeEqual } from "crypto";
import { EmailLayoutSchema } from "@rhule/marketing-shared";
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var KIT_SEGMENTS = [
  { id: "blog_subscribers", label: "Blog subscribers", description: "People who subscribed from the public journal.", count: 0 },
  { id: "custom", label: "Custom filter", description: "Build an ad-hoc audience from user type, plan, signup date, or email domain.", count: 0 }
];
var EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
function compilePath(path) {
  const keys = [];
  const src = path.replace(/:([a-zA-Z]+)/g, (_m, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${src}/?$`), keys };
}
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}
function sendText(res, status, contentType, body, cache = "no-store") {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", cache);
  res.end(body);
}
async function readRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody);
  if (req.readableEnded || typeof req[Symbol.asyncIterator] !== "function") {
    if (Buffer.isBuffer(req.body)) return req.body;
    return Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2e6) throw new HttpError(413, "Body too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return {};
  if (req.readableEnded && !req.rawBody && typeof req.body !== "string") return {};
  const raw = await readRawBody(req);
  req.rawBody = raw;
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return {};
  }
}
function headerValue(req, name) {
  const v = req.headers?.[name.toLowerCase()];
  return Array.isArray(v) ? String(v[0] || "") : String(v || "");
}
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
function verifySvixSignature(input) {
  if (!input.secret || !input.id || !input.timestamp || !input.signatureHeader) return false;
  const ts = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1e3);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (input.toleranceSeconds ?? 300)) return false;
  const key = Buffer.from(input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret, "base64");
  const payload = typeof input.payload === "string" ? input.payload : input.payload.toString("utf8");
  const expected = createHmac("sha256", key).update(`${input.id}.${input.timestamp}.${payload}`).digest("base64");
  return input.signatureHeader.split(" ").map((part) => part.split(",")[1] || "").some((sig) => sig && safeEqual(sig, expected));
}
async function mapLimit(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}
function escapeHtml3(raw) {
  return String(raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function simplePage(brand, title, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${escapeHtml3(title)} \xB7 ${escapeHtml3(brand.name)}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a;">
<main style="max-width:520px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;">
<div style="font-family:Georgia,serif;font-weight:700;font-size:20px;margin-bottom:18px;">${escapeHtml3(brand.name)}</div>
<h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 12px;">${escapeHtml3(title)}</h1>${bodyHtml}
<p style="margin-top:24px"><a href="https://${escapeHtml3(brand.domain)}/" style="color:#1d4ed8">Return to ${escapeHtml3(brand.domain)}</a></p>
</main></body></html>`;
}
function createMarketingKit(opts) {
  const store = new MarketingStore(opts.db);
  const log = opts.logger || console;
  const mountPath = (opts.mountPath ?? "/marketing").replace(/\/$/, "");
  const contentBrief = typeof opts.contentBrief === "string" && opts.contentBrief.trim() ? opts.contentBrief.trim() : null;
  const jobs = /* @__PURE__ */ new Map();
  const subscribeHits = /* @__PURE__ */ new Map();
  const contextCache = /* @__PURE__ */ new Map();
  let schemaReady = null;
  const llmTimeoutMs = opts.llmTimeoutMs ?? 24e4;
  const llm = {
    complete: (input) => new Promise((resolve2, reject) => {
      const timer = setTimeout(() => reject(new Error(`LLM timed out after ${Math.round(llmTimeoutMs / 1e3)}s`)), llmTimeoutMs);
      opts.llm.complete(input).then(
        (v) => (clearTimeout(timer), resolve2(v)),
        (e) => (clearTimeout(timer), reject(e))
      );
    })
  };
  const ensureSchema = () => {
    if (!schemaReady) {
      schemaReady = ensureMarketingSchema(opts.db).then(() => void 0).catch((err) => {
        schemaReady = null;
        throw err;
      });
    }
    return schemaReady;
  };
  const knownTenants = () => Array.from(/* @__PURE__ */ new Set([opts.tenantId, ...Object.keys(opts.brandsByTenant || {})]));
  const brandFor = (tenantId) => opts.brandsByTenant?.[tenantId] || (tenantId === opts.tenantId ? opts.brand : { ...opts.brand, tenantId });
  const publicOrigin = (brand) => (opts.assetBaseUrl || `https://${brand.domain}`).replace(/\/$/, "");
  const mediaUrl = (assetId, ext) => `${opts.assetBaseUrl || ""}${mountPath}/media/${assetId}.${ext}`;
  async function productContext(tenantId) {
    const cached = contextCache.get(tenantId);
    if (cached && Date.now() - cached.at < 6e4) return cached.ctx;
    const brand = brandFor(tenantId);
    let extra = {};
    try {
      extra = await opts.getProductContext?.(tenantId) || {};
    } catch (err) {
      log.warn("[marketing-kit] getProductContext failed", err);
    }
    const ctx = {
      tenantId,
      productName: brand.name,
      domain: brand.domain,
      tagline: brand.tagline,
      brandVoice: brand.brandVoice,
      primaryColor: brand.primaryColor,
      accentColor: brand.accentColor,
      pricingSummary: brand.pricingSummary,
      coreFeatures: brand.coreFeatures,
      targetAudiences: brand.targetAudiences,
      ...extra
    };
    contextCache.set(tenantId, { at: Date.now(), ctx });
    return ctx;
  }
  async function searchCode(query, limit = 6) {
    if (!opts.codebase || !query.trim()) return [];
    try {
      return await opts.codebase.search(query, limit);
    } catch {
      return [];
    }
  }
  async function listSegments(tenantId) {
    let hostSegments = [];
    try {
      hostSegments = await opts.listSegments?.(tenantId) || [];
    } catch (err) {
      log.warn("[marketing-kit] listSegments failed", err);
    }
    const blogSubs = await store.listBlogSubscribers(tenantId);
    const kit = KIT_SEGMENTS.map(
      (s) => s.id === "blog_subscribers" ? { ...s, count: blogSubs.length, sampleEmails: blogSubs.slice(0, 3).map((r) => String(r.email)) } : s
    );
    const seen = new Set(hostSegments.map((s) => s.id));
    return [...hostSegments, ...kit.filter((s) => !seen.has(s.id))];
  }
  async function resolveContacts(tenantId, segmentId, filter) {
    if (segmentId === "blog_subscribers") {
      const rows = await store.listBlogSubscribers(tenantId);
      return rows.map((r) => ({
        id: String(r.id),
        tenantId,
        email: String(r.email),
        firstName: String(r.name || "").split(" ")[0] || "there",
        name: String(r.name || ""),
        planTier: "subscriber",
        lifecycleState: "subscriber",
        marketingOptIn: true,
        unsubscribeToken: String(r.unsubscribe_token)
      }));
    }
    if (!opts.resolveSegmentContacts) return [];
    return opts.resolveSegmentContacts(tenantId, segmentId, filter);
  }
  async function refineStudioSpec(base, title, instruction) {
    try {
      const raw = await llm.complete({
        system: `You design text for an editorial "studio card" hero graphic. Return JSON only with these string fields:
caption, docTitle, docHighlight, docReference, calloutBadge, calloutTitle, calloutSubtitle, chipFrom, chipTo, and palette (navy|emerald|amber|purple).
Keep each field short (docHighlight <= 90 chars, others <= 40). Never invent case citations.`,
        user: `Article: ${title}
Current card: ${JSON.stringify(base)}
Instruction: ${instruction}`,
        temperature: 0.5
      });
      const parsed = parseJsonLoose(raw);
      if (!parsed) return base;
      const merged = { ...base };
      for (const k of Object.keys(base)) {
        const v = parsed[k];
        if (typeof v === "string" && v.trim()) merged[k] = v.trim().slice(0, 120);
      }
      if (!["navy", "emerald", "amber", "purple"].includes(String(merged.palette))) merged.palette = base.palette;
      return merged;
    } catch {
      return base;
    }
  }
  async function produceArtwork(input) {
    let warning;
    if (input.mode === "ai_illustration" && opts.imageGen) {
      const prompt = [
        input.prompt || `Editorial illustration for "${input.title}"`,
        input.instruction ? `Art direction: ${input.instruction}` : "",
        `Style: refined editorial illustration for ${input.brand.name}, palette anchored on ${input.brand.primaryColor} and ${input.brand.accentColor}, soft natural light, generous negative space.`,
        "Absolutely no text, letters, numbers, logos, or watermarks. No gavels or courtroom cliches unless requested. Wide 3:2 composition."
      ].filter(Boolean).join("\n");
      try {
        const img = await opts.imageGen.generateImage({ prompt, targetType: input.targetType, size: "1536x1024" });
        const id2 = newId("asset");
        const ext = img.contentType.includes("jpeg") ? "jpg" : img.contentType.includes("webp") ? "webp" : "png";
        const url2 = mediaUrl(id2, ext);
        await store.createAsset({
          id: id2,
          tenantId: input.tenantId,
          targetType: input.targetType,
          targetId: input.targetId,
          mode: "ai_illustration",
          prompt,
          customInstruction: input.instruction || null,
          imageUrl: url2,
          contentType: img.contentType,
          data: img.data
        });
        return { url: url2, mode: "ai_illustration", spec: null };
      } catch (err) {
        warning = `AI image generation failed (${String(err?.message || err).slice(0, 160)}); used a studio card instead.`;
        log.warn("[marketing-kit] image generation failed, using studio card", err?.message || err);
      }
    }
    let spec = input.existingSpec && !input.instruction ? input.existingSpec : buildDefaultStudioCardSpec({ title: input.title, kicker: input.kicker, customInstruction: input.instruction, brand: input.brand });
    if (input.instruction) spec = await refineStudioSpec(input.existingSpec || spec, input.title, input.instruction);
    const svg = renderEditorialSvgArtwork({ title: input.title, kicker: input.kicker, targetType: input.targetType, spec, brand: input.brand });
    let data = svg;
    let contentType = "image/svg+xml";
    if (opts.rasterizeSvg) {
      try {
        data = await opts.rasterizeSvg(svg, 1200);
        contentType = "image/png";
      } catch (err) {
        log.warn("[marketing-kit] rasterizeSvg failed", err);
      }
    }
    const id = newId("asset");
    const url = mediaUrl(id, contentType === "image/png" ? "png" : "svg");
    await store.createAsset({
      id,
      tenantId: input.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      mode: "studio_card",
      prompt: input.prompt,
      customInstruction: input.instruction || null,
      imageUrl: url,
      contentType,
      data,
      studioCardSpec: spec
    });
    return { url, mode: "studio_card", spec, warning };
  }
  async function generateIntoPost(tenantId, postId, topic, audience, instruction, artworkMode) {
    const ctx = await productContext(tenantId);
    const hits = await searchCode(`${topic} ${instruction || ""}`, 5);
    const { draft, usedFallback, error } = await generatePostDraft({ llm, ctx, hits, topic, audience, instruction, contentBrief });
    const slug = await store.uniqueSlug(tenantId, draft.slug, postId);
    let post = await store.updatePost(tenantId, postId, {
      ...draft,
      slug,
      status: "draft",
      artworkMode,
      artworkStatus: "generating",
      generationError: usedFallback ? error || "Used template fallback" : null
    });
    if (!post) return;
    const art = await produceArtwork({
      tenantId,
      brand: brandFor(tenantId),
      targetType: "blog",
      targetId: postId,
      title: post.title,
      kicker: post.kicker,
      prompt: draft.artworkPrompt,
      mode: artworkMode
    });
    post = await store.updatePost(tenantId, postId, {
      heroImageUrl: art.url,
      artworkMode: art.mode,
      studioCardSpec: art.spec,
      artworkStatus: "draft",
      ...art.warning && !usedFallback ? { generationError: art.warning } : {}
    });
  }
  function startBatch(tenantId, topics, audience, instruction, artworkMode, postIds) {
    const job = {
      id: newId("job"),
      tenantId,
      total: topics.length,
      completed: 0,
      failed: 0,
      postIds,
      status: "running",
      startedAt: nowIso(),
      finishedAt: null
    };
    jobs.set(job.id, job);
    void mapLimit(topics, opts.generationConcurrency || 3, async (topic, i) => {
      try {
        await generateIntoPost(tenantId, postIds[i], topic, audience, instruction, artworkMode);
        job.completed += 1;
      } catch (err) {
        job.failed += 1;
        await store.updatePost(tenantId, postIds[i], { status: "draft", artworkStatus: "draft", generationError: String(err?.message || err).slice(0, 300) }).catch(() => {
        });
      }
    }).finally(() => {
      job.status = job.failed === job.total ? "failed" : "completed";
      job.finishedAt = nowIso();
      setTimeout(() => jobs.delete(job.id), 60 * 60 * 1e3).unref?.();
    });
    return job;
  }
  function renderCampaignHtml(c, brand, bannerKicker) {
    return buildResponsiveEmailHtml({
      brand,
      subject: c.subject,
      preheader: c.preheader,
      headline: c.headline,
      bodyMarkdown: c.bodyMarkdown,
      ctaLabel: c.ctaLabel,
      ctaUrl: c.ctaUrl,
      bannerImageUrl: c.bannerImageUrl,
      layout: c.layout,
      bannerKicker
    });
  }
  function contactVars(contact, brand, unsubscribeUrl) {
    return {
      firstName: contact.firstName || (contact.name || "").split(" ")[0] || "there",
      name: contact.name || "",
      email: contact.email || "",
      matterTitle: contact.matterTitle || "your matter",
      proposedDocsList: contact.proposedDocsList || "- Your proposed documents",
      unlockUrl: contact.unlockUrl || `https://${brand.domain}/`,
      unsubscribeUrl
    };
  }
  function personalize(html, vars) {
    const listHtml = vars.proposedDocsList.split(/\n/).map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean).map((l) => `<li style="margin:0 0 6px;">${escapeHtml3(l)}</li>`).join("");
    const withList = html.replace(/<p[^>]*>\s*\{\{\s*proposedDocsList\s*\}\}\s*<\/p>/g, `<ul style="margin:0 0 16px;padding-left:20px;">${listHtml}</ul>`);
    return interpolateEmailVariables(withList, vars);
  }
  async function sampleContact(tenantId, segmentId, filter) {
    try {
      const contacts = await resolveContacts(tenantId, segmentId, filter);
      if (contacts[0]) return contacts[0];
    } catch {
    }
    return { firstName: "Alex", name: "Alex Rivera", email: "alex@example.com", matterTitle: "Smith v. Landlord Holdings", proposedDocsList: "- Answer to Complaint\n- Motion to Dismiss", unlockUrl: "#" };
  }
  async function sendCampaign(tenantId, campaignId) {
    const campaign = await store.getCampaign(tenantId, campaignId);
    if (!campaign) throw new HttpError(404, "Campaign not found");
    const claimed = await store.claimCampaignForSend(campaignId, ["draft", "approved", "scheduled", "failed"]);
    if (!claimed) throw new HttpError(409, "Campaign is already sending or sent");
    const brand = brandFor(tenantId);
    try {
      if (!opts.email) throw new Error("No email provider configured");
      const contacts = await resolveContacts(tenantId, campaign.segmentId, campaign.segmentFilter || null);
      const suppressed = await store.suppressedEmails(tenantId);
      const seen = /* @__PURE__ */ new Set();
      const messages = [];
      for (const contact of contacts) {
        const email = String(contact.email || "").trim().toLowerCase();
        if (!EMAIL_RE.test(email) || seen.has(email) || suppressed.has(email) || contact.marketingOptIn === false) continue;
        seen.add(email);
        const sub = await store.ensureSubscriber(tenantId, email, contact.name || null, campaign.segmentId === "blog_subscribers" ? "blog_inline" : "account");
        if (sub.unsubscribed) continue;
        const unsubscribeUrl = `${publicOrigin(brand)}${mountPath}/unsubscribe?token=${encodeURIComponent(sub.token)}&c=${encodeURIComponent(campaignId)}`;
        const vars = contactVars(contact, brand, unsubscribeUrl);
        messages.push({
          to: email,
          name: contact.name || "",
          subject: interpolateEmailVariables(campaign.subject, vars, { escape: false }),
          html: personalize(campaign.bodyHtml, vars),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>${brand.contactEmail ? `, <mailto:${brand.contactEmail}?subject=unsubscribe>` : ""}`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
          },
          tags: [
            { name: "campaign_id", value: campaignId },
            { name: "tenant", value: tenantId.replace(/[^a-zA-Z0-9_-]/g, "_") }
          ]
        });
      }
      let sent = 0;
      let failedCount = 0;
      const errors = [];
      for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        const results = opts.email.sendBatch ? await opts.email.sendBatch(chunk.map(({ name: _n, ...m }) => m)) : await Promise.all(chunk.map(async ({ name: _n, ...m }) => ({ to: m.to, ...await opts.email.sendEmail(m) })));
        for (let j = 0; j < chunk.length; j++) {
          const r = results[j] || { status: "failed", error: "missing result" };
          if (r.status === "sent") sent += 1;
          else {
            failedCount += 1;
            if (r.error && errors.length < 3) errors.push(r.error);
          }
          await store.addRecipient({
            campaignId,
            tenantId,
            email: chunk[j].to,
            contactName: chunk[j].name,
            providerMessageId: r.providerMessageId || null,
            status: r.status === "sent" ? "sent" : r.status
          });
        }
      }
      const status = messages.length > 0 && sent === 0 ? "failed" : "sent";
      return store.updateCampaign(tenantId, campaignId, {
        status,
        recipientCount: messages.length,
        sentCount: sent,
        sentAt: nowIso(),
        lastError: errors.length ? `${failedCount} failed: ${errors.join("; ")}`.slice(0, 500) : messages.length === 0 ? "No eligible recipients in this segment." : null
      });
    } catch (err) {
      return store.updateCampaign(tenantId, campaignId, { status: "failed", lastError: String(err?.message || err).slice(0, 500) });
    }
  }
  async function runScheduledWork() {
    await ensureSchema();
    const runningPostIds = new Set(Array.from(jobs.values()).filter((j) => j.status === "running").flatMap((j) => j.postIds));
    const staleBefore = new Date(Date.now() - Math.max(llmTimeoutMs * 3, 15 * 6e4)).toISOString();
    await store.recoverStaleGenerating(staleBefore, Array.from(runningPostIds));
    let campaignsSent = 0;
    for (const c of await store.listDueCampaigns()) {
      try {
        await sendCampaign(c.tenantId, c.id);
        campaignsSent += 1;
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 409)) log.error("[marketing-kit] scheduled send failed", err);
      }
    }
    let postsPublished = 0;
    for (const tenantId of knownTenants()) {
      const scheduled = await store.listPosts(tenantId, { status: "scheduled", limit: 50 });
      for (const p of scheduled) {
        if (p.publishedAt && p.publishedAt <= nowIso()) {
          await store.updatePost(tenantId, p.id, { status: "published" });
          postsPublished += 1;
        }
      }
    }
    return { campaignsSent, postsPublished };
  }
  const routes = [];
  const add = (method, path, handler2, flags = {}) => {
    const { pattern, keys } = compilePath(path);
    routes.push({ method, pattern, keys, handler: handler2, ...flags });
  };
  const requirePost = async (ctx) => {
    const post = await store.getPost(ctx.tenantId, ctx.params.id);
    if (!post) throw new HttpError(404, "Post not found");
    return post;
  };
  const requireCampaign = async (ctx) => {
    const c = await store.getCampaign(ctx.tenantId, ctx.params.id);
    if (!c) throw new HttpError(404, "Campaign not found");
    return c;
  };
  const artworkModeOf = (v, fallback = "ai_illustration") => v === "studio_card" ? "studio_card" : v === "ai_illustration" ? "ai_illustration" : fallback;
  const audienceOf = (v) => v === "individual" || v === "attorney" ? v : "general";
  add("GET", "/health", () => ({ ok: true, tenants: knownTenants(), imageGen: Boolean(opts.imageGen), email: Boolean(opts.email) }), { public: true });
  add("GET", "/context", async (ctx) => {
    const product = await productContext(ctx.tenantId);
    return { context: product, capabilities: { imageGen: Boolean(opts.imageGen), email: Boolean(opts.email), codebase: opts.codebase?.label || null } };
  });
  add("GET", "/overview", async (ctx) => ({ overview: await store.overview(ctx.tenantId) }), { allowAllTenant: true });
  add("GET", "/copilot/messages", async (ctx) => ({ messages: await store.listMessages(ctx.tenantId) }));
  add("DELETE", "/copilot/messages", async (ctx) => {
    await store.clearMessages(ctx.tenantId);
    return { ok: true };
  });
  add("POST", "/copilot/chat", async (ctx) => {
    const message = String(ctx.body?.message || "").trim().slice(0, 4e3);
    if (!message) throw new HttpError(400, "message is required");
    const history = await store.listMessages(ctx.tenantId, 20);
    const userMessage = await store.addMessage(ctx.tenantId, "user", message);
    const [product, hits, segments] = await Promise.all([productContext(ctx.tenantId), searchCode(message, 6), listSegments(ctx.tenantId)]);
    const { reply, actions } = await runCopilotTurn({
      llm,
      ctx: product,
      hits,
      history,
      message,
      segmentIds: segments.filter((s) => s.id !== "custom").map((s) => s.id),
      contentBrief
    });
    const assistant = await store.addMessage(ctx.tenantId, "assistant", reply, { actions, sources: hits.map((h) => h.path) });
    return { userMessage, message: assistant };
  });
  add("POST", "/blog/ideas", async (ctx) => {
    const product = await productContext(ctx.tenantId);
    const theme = String(ctx.body?.theme || "").slice(0, 500);
    const existing = await store.listPosts(ctx.tenantId, { limit: 80 });
    const ideas = await generateBlogIdeas({
      llm,
      ctx: product,
      hits: await searchCode(theme || product.coreFeatures.join(" "), 4),
      count: Number(ctx.body?.count) || 6,
      audience: ctx.body?.audience,
      theme,
      existingTitles: existing.map((p) => p.title),
      contentBrief
    });
    return { ideas };
  });
  add("POST", "/blog/generate-batch", async (ctx) => {
    const audience = audienceOf(ctx.body?.audience);
    const instruction = String(ctx.body?.instruction || "").slice(0, 2e3) || void 0;
    const artworkMode = artworkModeOf(ctx.body?.artworkMode);
    let topics = Array.isArray(ctx.body?.topics) ? ctx.body.topics.map((t) => String(t || "").trim().slice(0, 240)).filter(Boolean) : [];
    const count = Math.min(Math.max(Number(ctx.body?.count) || topics.length || 3, 1), 12);
    if (topics.length < count) {
      const product = await productContext(ctx.tenantId);
      const existing = await store.listPosts(ctx.tenantId, { limit: 80 });
      const ideas = await generateBlogIdeas({
        llm,
        ctx: product,
        hits: [],
        count: count - topics.length,
        audience,
        theme: String(ctx.body?.theme || instruction || ""),
        existingTitles: [...existing.map((p) => p.title), ...topics],
        contentBrief
      });
      topics = [...topics, ...ideas.map((i) => i.title)];
    }
    topics = topics.slice(0, count);
    const placeholders = [];
    for (const topic of topics) {
      placeholders.push(
        await store.createPost(ctx.tenantId, {
          title: topic,
          slug: `draft-${topic}`,
          status: "generating",
          audience,
          artworkMode,
          artworkStatus: "generating",
          sourceTopic: topic,
          authorName: `${ctx.brand.name} Editorial`
        })
      );
    }
    const job = startBatch(ctx.tenantId, topics, audience, instruction, artworkMode, placeholders.map((p) => p.id));
    ctx.res.statusCode = 202;
    return { job, posts: placeholders };
  });
  add("GET", "/blog/jobs/:id", (ctx) => {
    const job = jobs.get(ctx.params.id);
    if (!job || job.tenantId !== ctx.tenantId) throw new HttpError(404, "Job not found");
    return { job };
  });
  add("GET", "/blog/posts", async (ctx) => ({ posts: await store.listPosts(ctx.tenantId, { status: ctx.query.get("status") || void 0, limit: Number(ctx.query.get("limit")) || 100 }) }), { allowAllTenant: true });
  add("GET", "/blog/posts/:id", async (ctx) => {
    const post = await requirePost(ctx);
    const [revisions, assets] = await Promise.all([store.listRevisions(post.id), store.listAssets("blog", post.id)]);
    return { post, revisions, assets, sections: splitSections(post.bodyMarkdown).filter((s) => s.heading).map((s) => s.heading) };
  });
  add("PATCH", "/blog/posts/:id", async (ctx) => {
    const post = await requirePost(ctx);
    const b = ctx.body || {};
    const patch = {};
    for (const k of ["title", "kicker", "excerpt", "bodyMarkdown", "seoTitle", "seoDescription", "ctaLabel", "ctaUrl", "artworkPrompt"]) {
      if (typeof b[k] === "string") patch[k] = b[k].slice(0, k === "bodyMarkdown" ? 6e4 : 1e3);
    }
    if (Array.isArray(b.targetKeywords)) patch.targetKeywords = b.targetKeywords.map(String).slice(0, 15);
    if (Array.isArray(b.faqItems)) patch.faqItems = b.faqItems.filter((f) => f?.question && f?.answer).slice(0, 8);
    if (b.audience) patch.audience = audienceOf(b.audience);
    if (typeof b.slug === "string" && b.slug.trim()) patch.slug = await store.uniqueSlug(ctx.tenantId, b.slug, post.id);
    if (typeof patch.bodyMarkdown === "string") patch.readingTimeMinutes = Math.max(2, Math.round(patch.bodyMarkdown.split(/\s+/).length / 220));
    if (patch.bodyMarkdown !== void 0 || patch.title !== void 0) await store.addRevision(post, "Manual edit");
    return { post: await store.updatePost(ctx.tenantId, post.id, patch) };
  });
  add("POST", "/blog/posts/:id/rewrite", async (ctx) => {
    const post = await requirePost(ctx);
    const instruction = String(ctx.body?.instruction || "").trim().slice(0, 2e3);
    if (!instruction) throw new HttpError(400, "instruction is required");
    const sectionHeading = ctx.body?.sectionHeading ? String(ctx.body.sectionHeading) : void 0;
    const product = await productContext(ctx.tenantId);
    let patch = null;
    try {
      patch = await rewritePost({ llm, ctx: product, post, instruction, sectionHeading, contentBrief });
    } catch (err) {
      throw new HttpError(502, `Rewrite failed: ${String(err?.message || err).slice(0, 200)}`);
    }
    if (!patch) throw new HttpError(502, sectionHeading ? "Could not rewrite that section" : "The model returned an unusable rewrite");
    await store.addRevision(post, sectionHeading ? `Section "${sectionHeading}": ${instruction}` : instruction);
    const updated = await store.updatePost(ctx.tenantId, post.id, { ...patch, generationError: null });
    if (ctx.body?.regenerateArtwork) {
      const art = await produceArtwork({
        tenantId: ctx.tenantId,
        brand: ctx.brand,
        targetType: "blog",
        targetId: post.id,
        title: updated.title,
        kicker: updated.kicker,
        prompt: updated.artworkPrompt,
        instruction: String(ctx.body?.artworkInstruction || "") || void 0,
        mode: updated.artworkMode,
        existingSpec: updated.studioCardSpec
      });
      return { post: await store.updatePost(ctx.tenantId, post.id, { heroImageUrl: art.url, studioCardSpec: art.spec, artworkMode: art.mode, artworkStatus: "draft" }), warning: art.warning };
    }
    return { post: updated };
  });
  add("POST", "/blog/posts/:id/regenerate", async (ctx) => {
    const post = await requirePost(ctx);
    await store.addRevision(post, "Regenerated");
    await store.updatePost(ctx.tenantId, post.id, { status: post.status === "published" ? "published" : "generating", artworkStatus: "generating" });
    const artworkMode = artworkModeOf(ctx.body?.artworkMode, post.artworkMode);
    const instruction = String(ctx.body?.instruction || "").slice(0, 2e3) || void 0;
    const job = startBatch(ctx.tenantId, [post.sourceTopic || post.title], post.audience, instruction, artworkMode, [post.id]);
    ctx.res.statusCode = 202;
    return { job };
  });
  add("POST", "/blog/posts/:id/revisions/:revisionId/restore", async (ctx) => {
    const post = await requirePost(ctx);
    const rev = await store.getRevision(post.id, ctx.params.revisionId);
    if (!rev) throw new HttpError(404, "Revision not found");
    await store.addRevision(post, `Before restoring revision from ${rev.createdAt}`);
    return {
      post: await store.updatePost(ctx.tenantId, post.id, {
        title: rev.title,
        excerpt: rev.excerpt,
        bodyMarkdown: rev.bodyMarkdown,
        seoTitle: rev.seoTitle,
        seoDescription: rev.seoDescription
      })
    };
  });
  add("POST", "/blog/posts/:id/artwork", async (ctx) => {
    const post = await requirePost(ctx);
    const mode = artworkModeOf(ctx.body?.mode, post.artworkMode);
    const prompt = typeof ctx.body?.prompt === "string" && ctx.body.prompt.trim() ? ctx.body.prompt.trim().slice(0, 1500) : post.artworkPrompt;
    await store.updatePost(ctx.tenantId, post.id, { artworkStatus: "generating", artworkPrompt: prompt });
    const art = await produceArtwork({
      tenantId: ctx.tenantId,
      brand: ctx.brand,
      targetType: "blog",
      targetId: post.id,
      title: post.title,
      kicker: post.kicker,
      prompt,
      instruction: String(ctx.body?.instruction || "").slice(0, 1e3) || void 0,
      mode,
      existingSpec: mode === "studio_card" ? post.studioCardSpec : null
    });
    const updated = await store.updatePost(ctx.tenantId, post.id, { heroImageUrl: art.url, artworkMode: art.mode, studioCardSpec: art.spec, artworkStatus: "draft" });
    return { post: updated, assets: await store.listAssets("blog", post.id), warning: art.warning };
  });
  add("POST", "/blog/posts/:id/artwork/approve", async (ctx) => {
    const post = await requirePost(ctx);
    if (typeof ctx.body?.assetUrl === "string" && ctx.body.assetUrl) {
      const assets = await store.listAssets("blog", post.id);
      const chosen = assets.find((a) => a.imageUrl === ctx.body.assetUrl);
      if (!chosen) throw new HttpError(400, "Unknown asset");
      await store.updatePost(ctx.tenantId, post.id, { heroImageUrl: chosen.imageUrl, artworkMode: chosen.mode, studioCardSpec: chosen.studioCardSpec || null });
    }
    await store.approveLatestAsset("blog", post.id);
    return { post: await store.updatePost(ctx.tenantId, post.id, { artworkStatus: "approved" }) };
  });
  add("POST", "/blog/posts/:id/approve", async (ctx) => {
    const post = await requirePost(ctx);
    if (post.status === "generating") throw new HttpError(409, "Post is still generating");
    return { post: await store.updatePost(ctx.tenantId, post.id, { status: post.status === "published" ? "published" : "approved", artworkStatus: "approved" }) };
  });
  add("POST", "/blog/posts/:id/publish", async (ctx) => {
    const post = await requirePost(ctx);
    if (post.status === "generating") throw new HttpError(409, "Post is still generating");
    const publishAt = ctx.body?.publishAt ? new Date(String(ctx.body.publishAt)) : null;
    if (publishAt && !Number.isNaN(publishAt.getTime()) && publishAt.getTime() > Date.now() + 6e4) {
      return { post: await store.updatePost(ctx.tenantId, post.id, { status: "scheduled", publishedAt: publishAt.toISOString(), artworkStatus: "approved" }) };
    }
    return { post: await store.updatePost(ctx.tenantId, post.id, { status: "published", publishedAt: post.publishedAt && post.status === "published" ? post.publishedAt : nowIso(), artworkStatus: "approved" }) };
  });
  add("POST", "/blog/posts/:id/unpublish", async (ctx) => {
    const post = await requirePost(ctx);
    return { post: await store.updatePost(ctx.tenantId, post.id, { status: "draft" }) };
  });
  add("DELETE", "/blog/posts/:id", async (ctx) => {
    const post = await requirePost(ctx);
    return { post: await store.updatePost(ctx.tenantId, post.id, { status: "archived" }) };
  });
  add("GET", "/blog/posts/:id/preview", async (ctx) => {
    const post = await requirePost(ctx);
    const related = (await store.listPublishedPosts(ctx.tenantId, 4)).filter((p) => p.id !== post.id).slice(0, 3);
    const html = renderPublicBlogPostHtml({ post, relatedPosts: related, brand: ctx.brand }).replace("<head>", '<head><meta name="robots" content="noindex"/>');
    sendText(ctx.res, 200, "text/html; charset=utf-8", html);
    return void 0;
  });
  add("GET", "/segments", async (ctx) => ({ segments: await listSegments(ctx.tenantId) }));
  add("POST", "/segments/preview", async (ctx) => {
    const segmentId = String(ctx.body?.segmentId || "");
    if (!segmentId) throw new HttpError(400, "segmentId is required");
    const contacts = await resolveContacts(ctx.tenantId, segmentId, ctx.body?.filter || null);
    const suppressed = await store.suppressedEmails(ctx.tenantId);
    const eligible = contacts.filter((c) => c.marketingOptIn !== false && !suppressed.has(String(c.email).toLowerCase()));
    return {
      count: eligible.length,
      suppressed: contacts.length - eligible.length,
      sample: eligible.slice(0, 8).map((c) => ({ email: c.email, name: c.name, planTier: c.planTier, userType: c.userType, matterTitle: c.matterTitle }))
    };
  });
  add("POST", "/email/ideas", async (ctx) => {
    const segmentId = String(ctx.body?.segmentId || "all_individuals");
    const segments = await listSegments(ctx.tenantId);
    const seg = segments.find((s) => s.id === segmentId);
    return { ideas: await generateEmailIdeas({ llm, ctx: await productContext(ctx.tenantId), segmentId, segmentLabel: seg?.label || segmentId, goal: String(ctx.body?.goal || ""), contentBrief }) };
  });
  add("GET", "/email/campaigns", async (ctx) => ({ campaigns: await store.listCampaigns(ctx.tenantId) }), { allowAllTenant: true });
  add("POST", "/email/campaigns", async (ctx) => {
    const segmentId = String(ctx.body?.segmentId || "").trim();
    const goal = String(ctx.body?.goal || "").trim().slice(0, 1e3);
    if (!segmentId) throw new HttpError(400, "segmentId is required");
    if (!goal) throw new HttpError(400, "goal is required");
    const segments = await listSegments(ctx.tenantId);
    const seg = segments.find((s) => s.id === segmentId);
    if (!seg) throw new HttpError(400, `Unknown segment ${segmentId}`);
    const layoutParsed = EmailLayoutSchema.safeParse(ctx.body?.layout);
    const layout = layoutParsed.success ? layoutParsed.data : "editorial";
    const artworkMode = artworkModeOf(ctx.body?.artworkMode);
    const product = await productContext(ctx.tenantId);
    const { draft } = await generateEmailDraft({
      llm,
      ctx: product,
      hits: await searchCode(goal, 4),
      segmentId,
      segmentLabel: seg.label,
      goal,
      instruction: String(ctx.body?.instruction || "") || void 0,
      contentBrief
    });
    let campaign = await store.createCampaign(ctx.tenantId, {
      ...draft,
      name: String(ctx.body?.name || "") || draft.name,
      segmentId,
      segmentFilter: ctx.body?.filter || null,
      goal,
      layout,
      artworkMode,
      artworkStatus: "generating"
    });
    let warning;
    if (ctx.body?.withArtwork !== false && layout !== "minimal") {
      const art = await produceArtwork({
        tenantId: ctx.tenantId,
        brand: ctx.brand,
        targetType: "email",
        targetId: campaign.id,
        title: draft.headline,
        kicker: draft.bannerKicker || ctx.brand.name,
        prompt: draft.artworkPrompt,
        mode: artworkMode
      });
      warning = art.warning;
      campaign = await store.updateCampaign(ctx.tenantId, campaign.id, { bannerImageUrl: art.url, artworkMode: art.mode, studioCardSpec: art.spec });
    }
    campaign = await store.updateCampaign(ctx.tenantId, campaign.id, {
      artworkStatus: "draft",
      bodyHtml: renderCampaignHtml(campaign, ctx.brand, draft.bannerKicker)
    });
    return { campaign, warning };
  });
  add("GET", "/email/campaigns/:id", async (ctx) => {
    const campaign = await requireCampaign(ctx);
    const [recipients, assets] = await Promise.all([store.listRecipients(campaign.id, 100), store.listAssets("email", campaign.id)]);
    return { campaign, recipients, assets };
  });
  add("PATCH", "/email/campaigns/:id", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (["sending", "sent"].includes(c.status)) throw new HttpError(409, "Sent campaigns cannot be edited");
    const b = ctx.body || {};
    const patch = {};
    for (const k of ["name", "subject", "preheader", "headline", "bodyMarkdown", "ctaLabel", "ctaUrl", "artworkPrompt", "segmentId"]) {
      if (typeof b[k] === "string") patch[k] = b[k].slice(0, k === "bodyMarkdown" ? 2e4 : 1e3);
    }
    if (b.layout && EmailLayoutSchema.safeParse(b.layout).success) patch.layout = b.layout;
    if (b.filter !== void 0) patch.segmentFilter = b.filter;
    const merged = { ...c, ...patch };
    patch.bodyHtml = renderCampaignHtml(merged, ctx.brand);
    return { campaign: await store.updateCampaign(ctx.tenantId, c.id, patch) };
  });
  add("POST", "/email/campaigns/:id/refine", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (["sending", "sent"].includes(c.status)) throw new HttpError(409, "Sent campaigns cannot be edited");
    const instruction = String(ctx.body?.instruction || "").trim().slice(0, 2e3);
    const target = ["copy", "layout", "artwork", "all"].includes(ctx.body?.target) ? ctx.body.target : "all";
    if (!instruction && target !== "artwork") throw new HttpError(400, "instruction is required");
    const patch = {};
    let warning;
    if (target === "copy" || target === "all") {
      const product = await productContext(ctx.tenantId);
      const revised = await refineEmailCopy({
        llm,
        ctx: product,
        segmentId: c.segmentId,
        instruction,
        contentBrief,
        current: { name: c.name, subject: c.subject, preheader: c.preheader, headline: c.headline, bodyMarkdown: c.bodyMarkdown, ctaLabel: c.ctaLabel, ctaUrl: c.ctaUrl, artworkPrompt: c.artworkPrompt, bannerKicker: "" }
      }).catch(() => null);
      if (!revised && target === "copy") throw new HttpError(502, "The model returned an unusable revision");
      if (revised) Object.assign(patch, { subject: revised.subject, preheader: revised.preheader, headline: revised.headline, bodyMarkdown: revised.bodyMarkdown, ctaLabel: revised.ctaLabel, ctaUrl: revised.ctaUrl, artworkPrompt: revised.artworkPrompt || c.artworkPrompt });
    }
    if (target === "layout" || target === "all") {
      const requested = EmailLayoutSchema.safeParse(ctx.body?.layout);
      patch.layout = requested.success ? requested.data : layoutFromInstruction(instruction, c.layout);
    }
    const merged = { ...c, ...patch };
    if (target === "artwork" || target === "all" && /\b(art|image|banner|illustration|visual|colou?r|palette)\b/i.test(instruction)) {
      const mode = artworkModeOf(ctx.body?.mode, c.artworkMode);
      const art = await produceArtwork({
        tenantId: ctx.tenantId,
        brand: ctx.brand,
        targetType: "email",
        targetId: c.id,
        title: merged.headline,
        kicker: ctx.brand.name,
        prompt: typeof ctx.body?.prompt === "string" && ctx.body.prompt.trim() ? ctx.body.prompt.trim() : merged.artworkPrompt,
        instruction: instruction || void 0,
        mode,
        existingSpec: c.studioCardSpec
      });
      warning = art.warning;
      Object.assign(patch, { bannerImageUrl: art.url, artworkMode: art.mode, studioCardSpec: art.spec, artworkStatus: "draft" });
      merged.bannerImageUrl = art.url;
    }
    patch.bodyHtml = renderCampaignHtml({ ...merged, ...patch }, ctx.brand);
    if (c.status === "approved") patch.status = "draft";
    return { campaign: await store.updateCampaign(ctx.tenantId, c.id, patch), warning };
  });
  add("GET", "/email/campaigns/:id/preview", async (ctx) => {
    const c = await requireCampaign(ctx);
    const contact = await sampleContact(ctx.tenantId, c.segmentId, c.segmentFilter || null);
    const html = personalize(c.bodyHtml, contactVars(contact, ctx.brand, "#unsubscribe-preview"));
    sendText(ctx.res, 200, "text/html; charset=utf-8", html);
    return void 0;
  });
  add("POST", "/email/campaigns/:id/test-send", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (!opts.email) throw new HttpError(503, "No email provider configured");
    const to = String(ctx.body?.to || ctx.user?.email || headerValue(ctx.req, "x-marketing-actor-email") || "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) throw new HttpError(400, "A valid test recipient is required");
    const contact = await sampleContact(ctx.tenantId, c.segmentId, c.segmentFilter || null);
    const vars = contactVars({ ...contact, email: to }, ctx.brand, `${publicOrigin(ctx.brand)}${mountPath}/unsubscribe?token=test`);
    const result = await opts.email.sendEmail({
      to,
      subject: `[Test] ${interpolateEmailVariables(c.subject, vars, { escape: false })}`,
      html: personalize(c.bodyHtml, vars),
      tags: [{ name: "campaign_id", value: c.id }, { name: "test", value: "true" }]
    });
    if (result.status !== "sent") throw new HttpError(502, result.error || `Test send ${result.status}`);
    return { ok: true, to, providerMessageId: result.providerMessageId || null };
  });
  add("POST", "/email/campaigns/:id/approve", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (!["draft", "failed"].includes(c.status)) throw new HttpError(409, `Cannot approve a ${c.status} campaign`);
    await store.approveLatestAsset("email", c.id);
    return { campaign: await store.updateCampaign(ctx.tenantId, c.id, { status: "approved", artworkStatus: "approved" }) };
  });
  add("POST", "/email/campaigns/:id/send", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (["sending", "sent"].includes(c.status)) throw new HttpError(409, `Campaign is already ${c.status}`);
    if (c.status !== "approved" && c.status !== "scheduled" && !ctx.body?.confirm) {
      throw new HttpError(409, "Approve the campaign first, or pass confirm: true");
    }
    const scheduledAt = ctx.body?.scheduledAt ? new Date(String(ctx.body.scheduledAt)) : null;
    if (scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now() + 6e4) {
      return { campaign: await store.updateCampaign(ctx.tenantId, c.id, { status: "scheduled", scheduledAt: scheduledAt.toISOString() }) };
    }
    if (!opts.email) throw new HttpError(503, "No email provider configured");
    void sendCampaign(ctx.tenantId, c.id).catch((err) => log.error("[marketing-kit] send failed", err));
    ctx.res.statusCode = 202;
    return { campaign: { ...c, status: "sending" } };
  });
  add("POST", "/email/campaigns/:id/cancel-schedule", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (c.status !== "scheduled") throw new HttpError(409, "Campaign is not scheduled");
    return { campaign: await store.updateCampaign(ctx.tenantId, c.id, { status: "approved", scheduledAt: null }) };
  });
  add(
    "GET",
    "/media/:file",
    async (ctx) => {
      const id = ctx.params.file.replace(/\.[a-z0-9]+$/i, "");
      const asset = await store.getAssetBinary(id);
      if (!asset) throw new HttpError(404, "Not found");
      sendText(ctx.res, 200, asset.contentType, asset.data, "public, max-age=31536000, immutable");
      return void 0;
    },
    { public: true }
  );
  const coverCache = /* @__PURE__ */ new Map();
  add(
    "GET",
    "/blog/:slug/:cover",
    async (ctx) => {
      const ext = ctx.params.cover === "cover.png" ? "png" : ctx.params.cover === "cover.svg" ? "svg" : null;
      if (!ext) throw new HttpError(404, "Not found");
      const post = await store.getPostBySlug(ctx.tenantId, ctx.params.slug);
      if (!post || post.status !== "published") throw new HttpError(404, "Not found");
      const cacheKey = `${ctx.tenantId}:${post.slug}:${post.updatedAt}:${ext}`;
      const cached = coverCache.get(cacheKey);
      if (cached) {
        sendText(ctx.res, 200, cached.type, cached.data, "public, max-age=3600");
        return void 0;
      }
      const spec = post.studioCardSpec || buildDefaultStudioCardSpec({ title: post.title, kicker: post.kicker, brand: ctx.brand });
      const svg = renderEditorialSvgArtwork({ title: post.title, kicker: post.kicker, targetType: "blog", spec, brand: ctx.brand });
      let data = svg;
      let type = "image/svg+xml";
      if (ext === "png" && opts.rasterizeSvg) {
        try {
          data = await opts.rasterizeSvg(svg, 1200);
          type = "image/png";
        } catch (err) {
          log.warn("[marketing-kit] cover rasterize failed", err);
        }
      }
      if (coverCache.size > 200) coverCache.clear();
      coverCache.set(cacheKey, { at: Date.now(), type, data });
      sendText(ctx.res, 200, type, data, "public, max-age=3600");
      return void 0;
    },
    { public: true }
  );
  add(
    "POST",
    "/subscribe",
    async (ctx) => {
      const ip = String(headerValue(ctx.req, "x-forwarded-for").split(",")[0] || ctx.req.socket?.remoteAddress || "unknown").trim();
      const now = Date.now();
      const hits = (subscribeHits.get(ip) || []).filter((t) => now - t < 36e5);
      if (hits.length >= 10) throw new HttpError(429, "Too many requests");
      hits.push(now);
      subscribeHits.set(ip, hits);
      const email = String(ctx.body?.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, "A valid email is required");
      const source = String(ctx.body?.source || "blog_inline").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "blog_inline";
      await store.ensureSubscriber(ctx.tenantId, email, String(ctx.body?.name || "").slice(0, 120) || null, source === "account" ? "blog_inline" : source);
      await store.resubscribe(ctx.tenantId, email);
      return { ok: true };
    },
    { public: true }
  );
  const unsubscribe = async (ctx, confirm) => {
    const token = String(ctx.query.get("token") || ctx.body?.token || "");
    if (!token || token === "test") {
      sendText(ctx.res, token === "test" ? 200 : 400, "text/html; charset=utf-8", simplePage(ctx.brand, token === "test" ? "Test unsubscribe link" : "Invalid link", "<p>This link is not attached to a subscription.</p>"));
      return void 0;
    }
    if (!confirm) {
      const action = `${mountPath}/unsubscribe?token=${encodeURIComponent(token)}${ctx.query.get("c") ? `&c=${encodeURIComponent(String(ctx.query.get("c")))}` : ""}`;
      sendText(
        ctx.res,
        200,
        "text/html; charset=utf-8",
        simplePage(
          ctx.brand,
          "Unsubscribe from marketing email",
          `<p>You will stop receiving product updates and campaigns. Account and security emails will still be delivered.</p>
<form method="post" action="${escapeHtml3(action)}"><button type="submit" style="margin-top:12px;padding:12px 20px;border:0;border-radius:10px;background:#0c1931;color:#fff;font-weight:700;cursor:pointer">Unsubscribe</button></form>`
        )
      );
      return void 0;
    }
    const result = await store.unsubscribeByToken(token);
    const campaignId = String(ctx.query.get("c") || "");
    if (result && campaignId) await store.markRecipientUnsubscribed(campaignId, result.email);
    sendText(
      ctx.res,
      result ? 200 : 404,
      "text/html; charset=utf-8",
      simplePage(ctx.brand, result ? "You're unsubscribed" : "Link not found", result ? `<p>${escapeHtml3(result.email)} will no longer receive marketing email.</p>` : "<p>This unsubscribe link is invalid or expired.</p>")
    );
    return void 0;
  };
  add("GET", "/unsubscribe", (ctx) => unsubscribe(ctx, false), { public: true });
  add("POST", "/unsubscribe", (ctx) => unsubscribe(ctx, true), { public: true });
  add(
    "POST",
    "/webhooks/resend",
    async (ctx) => {
      const secret = (await opts.resendWebhookSecret?.())?.trim() || "";
      if (!secret) throw new HttpError(503, "Resend webhook secret not configured");
      const raw = await readRawBody(ctx.req);
      const ok = verifySvixSignature({
        secret,
        id: headerValue(ctx.req, "svix-id"),
        timestamp: headerValue(ctx.req, "svix-timestamp"),
        signatureHeader: headerValue(ctx.req, "svix-signature"),
        payload: raw
      });
      if (!ok) throw new HttpError(401, "Invalid signature");
      let event;
      try {
        event = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new HttpError(400, "Invalid JSON");
      }
      const messageId = String(event?.data?.email_id || "");
      const map = {
        "email.delivered": "delivered",
        "email.opened": "opened",
        "email.clicked": "clicked",
        "email.bounced": "bounced",
        "email.complained": "complained"
      };
      const kind = map[String(event?.type || "")];
      if (!kind || !messageId) return { ok: true, ignored: true };
      const applied = await store.applyDeliveryEvent(messageId, kind);
      if (kind === "bounced" || kind === "complained") {
        const rcpt = await store.recipientEmailForMessage(messageId);
        if (rcpt) await store.suppressEmail(rcpt.tenantId, rcpt.email);
      }
      return { ok: true, applied };
    },
    { public: true }
  );
  async function authenticate(req) {
    const key = headerValue(req, "x-ops-key").trim();
    if (key && opts.opsKeys) {
      const keys = (await opts.opsKeys() || []).map((k) => String(k || "").trim()).filter(Boolean);
      if (keys.some((k) => safeEqual(k, key))) {
        const email = headerValue(req, "x-marketing-actor-email").trim();
        return { id: "ops-hub", role: "ops", email: EMAIL_RE.test(email) ? email : void 0, name: "Ops Hub" };
      }
    }
    if (!opts.resolveUser) return null;
    try {
      return await opts.resolveUser(req) || null;
    } catch {
      return null;
    }
  }
  const handler = async (req, res, next) => {
    const url = new URL(String(req.url || "/"), "http://local");
    let path = url.pathname.replace(/\/+$/, "") || "/";
    let tenantId = opts.tenantId;
    const tenantMatch = path.match(/^\/t\/([a-z0-9_-]+)(\/.*)?$/i);
    if (tenantMatch) {
      tenantId = tenantMatch[1].toLowerCase();
      path = tenantMatch[2] || "/";
      if (tenantId !== "all" && !knownTenants().includes(tenantId)) return sendJson(res, 404, { error: `Unknown tenant ${tenantId}` });
    }
    const method = String(req.method || "GET").toUpperCase();
    const route = routes.find((r) => r.method === method && r.pattern.test(path));
    if (!route) {
      if (next) return next();
      return sendJson(res, 404, { error: "Not found" });
    }
    try {
      await ensureSchema();
      const user = route.public ? null : await authenticate(req);
      if (!route.public && (!user || user.role !== "admin" && user.role !== "ops")) {
        return sendJson(res, user ? 403 : 401, { error: user ? "Admin access required" : "Authentication required" });
      }
      if (tenantId === "all" && !route.allowAllTenant) {
        return sendJson(res, 400, { error: "Select a specific tenant for this action" });
      }
      const m = path.match(route.pattern);
      const params = {};
      route.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
      const body = method === "GET" || method === "HEAD" ? {} : await readJsonBody(req);
      const result = await route.handler({ req, res, params, query: url.searchParams, body, tenantId, brand: brandFor(tenantId === "all" ? opts.tenantId : tenantId), user });
      if (result !== void 0 && !res.writableEnded) sendJson(res, res.statusCode && res.statusCode !== 200 ? res.statusCode : 200, result);
    } catch (err) {
      if (res.writableEnded) return;
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      log.error("[marketing-kit] request failed", err);
      sendJson(res, 500, { error: "Internal error" });
    }
  };
  const publicHandlers = {
    async blogIndex(_req, res, next) {
      try {
        await ensureSchema();
        const posts = await store.listPublishedPosts(opts.tenantId);
        sendText(res, 200, "text/html; charset=utf-8", renderPublicBlogIndexHtml({ posts, brand: opts.brand }), "public, max-age=300");
      } catch (err) {
        log.error("[marketing-kit] blog index failed", err);
        if (next) next(err);
        else sendText(res, 500, "text/plain", "Error");
      }
    },
    async blogPost(req, res, next) {
      try {
        await ensureSchema();
        const slug = String(req.params?.slug || new URL(String(req.url || "/"), "http://local").pathname.split("/").filter(Boolean).pop() || "");
        const post = await store.getPostBySlug(opts.tenantId, slug);
        if (!post || post.status !== "published") {
          return sendText(res, 404, "text/html; charset=utf-8", simplePage(opts.brand, "Article not found", `<p>This article doesn't exist or is no longer published.</p><p><a href="/blog" style="color:#1d4ed8">Browse the journal</a></p>`));
        }
        const related = (await store.listPublishedPosts(opts.tenantId, 6)).filter((p) => p.id !== post.id).slice(0, 3);
        sendText(res, 200, "text/html; charset=utf-8", renderPublicBlogPostHtml({ post, relatedPosts: related, brand: opts.brand }), "public, max-age=300");
      } catch (err) {
        log.error("[marketing-kit] blog post failed", err);
        if (next) next(err);
        else sendText(res, 500, "text/plain", "Error");
      }
    },
    async sitemap(_req, res, next) {
      try {
        await ensureSchema();
        const posts = await store.listPublishedPosts(opts.tenantId, 1e3);
        sendText(res, 200, "application/xml; charset=utf-8", renderSitemapXml({ brand: opts.brand, posts }), "public, max-age=900");
      } catch (err) {
        log.error("[marketing-kit] sitemap failed", err);
        if (next) next(err);
        else sendText(res, 500, "text/plain", "Error");
      }
    }
  };
  async function seedPosts(tenantId, posts) {
    await ensureSchema();
    let created = 0;
    for (const p of posts) {
      if (await store.getPostBySlug(tenantId, p.slug)) continue;
      await store.createPost(tenantId, p);
      created += 1;
    }
    return created;
  }
  function startScheduler(intervalMs = 6e4) {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      runScheduledWork().catch((err) => log.error("[marketing-kit] scheduler failed", err)).finally(() => {
        running = false;
      });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
  return { handler, publicHandlers, store, ensureSchema, seedPosts, runScheduledWork, startScheduler };
}
function createMarketingRouter(opts) {
  return createMarketingKit(opts).handler;
}
export {
  DEFAULT_MARKETING_TABLE_PREFIX,
  KIT_SEGMENTS,
  MarketingStore,
  buildDefaultStudioCardSpec,
  buildMarketingSchemaStatements,
  buildResponsiveEmailHtml,
  contextBlock,
  createMarketingCodebaseAdapter,
  createMarketingKit,
  createMarketingRouter,
  ensureMarketingSchema,
  estimateReadingTime,
  generateBlogIdeas,
  generateEmailDraft,
  generateEmailIdeas,
  generatePostDraft,
  interpolateEmailVariables,
  layoutFromInstruction,
  newId,
  newToken,
  nowIso,
  parseJsonLoose,
  refineEmailCopy,
  renderEditorialSvgArtwork,
  renderMarkdownToHtmlAndToc,
  renderPublicBlogIndexHtml,
  renderPublicBlogPostHtml,
  renderSitemapXml,
  renderTableBannerHtml,
  rewritePost,
  rowToCampaign,
  rowToPost,
  runCopilotTurn,
  slugify,
  splitSections,
  templateEmailDraft,
  templatePostDraft,
  verifySvixSignature,
  writingRulesBlock
};
