// src/kb/codegen.ts
import { randomUUID } from "crypto";

// src/db/schema.ts
function buildSchemaStatements(tablePrefix) {
  const p = tablePrefix;
  return [
    `
    CREATE TABLE IF NOT EXISTS ${p}tickets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      public_number INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'support',
      topic TEXT NOT NULL DEFAULT 'other',
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      subject TEXT,
      severity TEXT,
      priority TEXT,
      user_id TEXT,
      org_id TEXT,
      guest_email TEXT,
      context_json TEXT,
      duplicate_of_ticket_id TEXT,
      assigned_to TEXT,
      github_issue_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      UNIQUE (tenant_id, public_number)
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}tickets_tenant_status ON ${p}tickets(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}tickets_tenant_kind ON ${p}tickets(tenant_id, kind)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}tickets_tenant_user ON ${p}tickets(tenant_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}tickets_tenant_created ON ${p}tickets(tenant_id, created_at)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}messages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      author_type TEXT NOT NULL,
      author_id TEXT,
      body TEXT NOT NULL,
      attachments_json TEXT,
      citation_json TEXT,
      created_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}messages_ticket ON ${p}messages(tenant_id, ticket_id)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}proposals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      proposal_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      summary TEXT NOT NULL,
      body_json TEXT NOT NULL,
      confidence REAL,
      telegram_message_id TEXT,
      telegram_chat_id TEXT,
      claimed_by TEXT,
      claimed_at TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      execution_status TEXT,
      execution_ref TEXT,
      created_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}proposals_ticket ON ${p}proposals(tenant_id, ticket_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}proposals_status ON ${p}proposals(tenant_id, status)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}telegram_draft_sessions (
      telegram_user_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      public_number INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS ${p}knowledge_gaps (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      public_number INTEGER,
      user_question TEXT NOT NULL,
      escalation_reason TEXT,
      doc_query TEXT,
      doc_hits_json TEXT,
      proposal_id TEXT,
      proposal_type TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}gaps_status ON ${p}knowledge_gaps(tenant_id, status)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}kb_articles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      source_kind TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'agent',
      provenance_json TEXT,
      source_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, source_kind, source_key)
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}kb_status ON ${p}kb_articles(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}kb_visibility ON ${p}kb_articles(tenant_id, visibility)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}leads (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      marketing_email_opt_in INTEGER NOT NULL DEFAULT 0,
      marketing_sms_opt_in INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'public_launcher',
      consent_text TEXT,
      consent_at TEXT,
      ip_hash TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, email)
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}leads_tenant_email ON ${p}leads(tenant_id, email)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}leads_marketing ON ${p}leads(tenant_id, marketing_email_opt_in)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      ingest_token_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}tenants_domain ON ${p}tenants(domain)`
  ];
}
function buildAlterStatements(tablePrefix) {
  const p = tablePrefix;
  return [
    {
      table: `${p}tickets`,
      column: "kind",
      ddl: `ALTER TABLE ${p}tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'support'`
    },
    {
      table: `${p}tickets`,
      column: "topic",
      ddl: `ALTER TABLE ${p}tickets ADD COLUMN topic TEXT NOT NULL DEFAULT 'other'`
    },
    {
      table: `${p}messages`,
      column: "citation_json",
      ddl: `ALTER TABLE ${p}messages ADD COLUMN citation_json TEXT`
    },
    {
      table: `${p}kb_articles`,
      column: "visibility",
      ddl: `ALTER TABLE ${p}kb_articles ADD COLUMN visibility TEXT NOT NULL DEFAULT 'agent'`
    },
    {
      table: `${p}proposals`,
      column: "telegram_chat_id",
      ddl: `ALTER TABLE ${p}proposals ADD COLUMN telegram_chat_id TEXT`
    },
    {
      table: `${p}proposals`,
      column: "claimed_by",
      ddl: `ALTER TABLE ${p}proposals ADD COLUMN claimed_by TEXT`
    },
    {
      table: `${p}proposals`,
      column: "claimed_at",
      ddl: `ALTER TABLE ${p}proposals ADD COLUMN claimed_at TEXT`
    }
  ];
}

// src/db/migrate.ts
var DEFAULT_TABLE_PREFIX = "support_";
async function columnExists(db, table, column) {
  try {
    const rows = await db.all(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_name = ? AND column_name = ?`,
      [table, column]
    );
    if (rows.length > 0) return true;
  } catch {
  }
  try {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    if (rows.length > 0) {
      return rows.some((r) => r.name === column);
    }
  } catch {
  }
  try {
    await db.get(`SELECT ${column} FROM ${table} LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}
async function runQuiet(db, sql) {
  try {
    await db.run(sql.trim());
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/no such|SQLITE_ERROR|Cannot read|null/i.test(message)) {
      console.warn(`[support-kit] ensureSchema statement failed: ${message}`);
    }
    return false;
  }
}
async function ensureSchema(db, tablePrefix = DEFAULT_TABLE_PREFIX) {
  if (!/^[a-z][a-z0-9_]*$/.test(tablePrefix)) {
    throw new Error(`ensureSchema: invalid tablePrefix "${tablePrefix}"`);
  }
  const statements = buildSchemaStatements(tablePrefix);
  const creates = statements.filter((s) => /^\s*CREATE\s+TABLE/i.test(s));
  const indexes = statements.filter((s) => /^\s*CREATE\s+INDEX/i.test(s));
  let applied = 0;
  for (const sql of creates) {
    if (await runQuiet(db, sql)) applied += 1;
  }
  for (const alter of buildAlterStatements(tablePrefix)) {
    const exists = await columnExists(db, alter.table, alter.column);
    if (!exists) {
      if (await runQuiet(db, alter.ddl)) applied += 1;
    }
  }
  for (const sql of indexes) {
    if (await runQuiet(db, sql)) applied += 1;
  }
  try {
    await db.run(`
      UPDATE ${tablePrefix}tickets SET
        kind = CASE category
          WHEN 'bug' THEN 'bug'
          WHEN 'feature' THEN 'feature'
          ELSE 'support'
        END,
        topic = CASE category
          WHEN 'billing' THEN 'billing'
          WHEN 'how_to' THEN 'how_to'
          WHEN 'feature' THEN 'product'
          WHEN 'bug' THEN 'other'
          ELSE COALESCE(NULLIF(topic, ''), 'other')
        END
      WHERE kind IS NULL OR kind = '' OR topic IS NULL OR topic = ''
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'support', topic = 'billing'
      WHERE category = 'billing'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'support', topic = 'how_to'
      WHERE category = 'how_to'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'bug', topic = COALESCE(NULLIF(topic, ''), 'other')
      WHERE category = 'bug'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'feature', topic = COALESCE(NULLIF(topic, ''), 'product')
      WHERE category = 'feature'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET status = 'waiting_user'
      WHERE status = 'pending_user'
    `);
  } catch {
  }
  return { tablePrefix, statements: applied };
}

// src/kb/codegen.ts
function mapKbArticle(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    body: row.body,
    status: row.status,
    sourceKind: row.source_kind,
    visibility: row.visibility ?? "agent",
    provenanceJson: row.provenance_json,
    sourceKey: row.source_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function ingestCodegenArticle(db, input) {
  const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const sourceKind = input.sourceKind ?? "codegen";
  const visibility = input.visibility ?? "agent";
  const provenanceJson = JSON.stringify({
    gitSha: input.gitSha ?? null,
    path: input.path ?? null,
    ingestedAt: now
  });
  const existing = await db.get(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND source_kind = ? AND source_key = ?`,
    [input.tenantId, sourceKind, input.sourceKey]
  );
  if (existing) {
    await db.run(
      `UPDATE ${table}
       SET title = ?, body = ?, status = 'draft', visibility = ?, provenance_json = ?, updated_at = ?
       WHERE id = ?`,
      [input.title, input.body, visibility, provenanceJson, now, existing.id]
    );
    const row2 = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [existing.id]);
    if (!row2) throw new Error("ingestCodegenArticle: upsert failed");
    return mapKbArticle(row2);
  }
  const id = randomUUID();
  await db.run(
    `INSERT INTO ${table} (
      id, tenant_id, title, body, status, source_kind, visibility, provenance_json, source_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.title,
      input.body,
      sourceKind,
      visibility,
      provenanceJson,
      input.sourceKey,
      now,
      now
    ]
  );
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new Error("ingestCodegenArticle: insert failed");
  return mapKbArticle(row);
}
async function promoteKbArticle(db, tenantId, id, tablePrefix, opts) {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = await db.get(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
    [tenantId, id]
  );
  if (!existing) {
    throw new Error(`promoteKbArticle: article not found (${id})`);
  }
  if (opts?.visibility) {
    await db.run(
      `UPDATE ${table} SET status = 'active', visibility = ?, updated_at = ? WHERE id = ?`,
      [opts.visibility, now, id]
    );
  } else {
    await db.run(
      `UPDATE ${table} SET status = 'active', updated_at = ? WHERE id = ?`,
      [now, id]
    );
  }
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new Error("promoteKbArticle: update failed");
  return mapKbArticle(row);
}
async function deprecateKbArticle(db, tenantId, id, tablePrefix) {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.run(
    `UPDATE ${table} SET status = 'deprecated', updated_at = ? WHERE tenant_id = ? AND id = ?`,
    [now, tenantId, id]
  );
  const row = await db.get(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
    [tenantId, id]
  );
  if (!row) throw new Error(`deprecateKbArticle: article not found (${id})`);
  return mapKbArticle(row);
}
async function updateKbArticle(db, tenantId, id, patch, tablePrefix) {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const existing = await db.get(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
    [tenantId, id]
  );
  if (!existing) throw new Error(`updateKbArticle: not found (${id})`);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.run(
    `UPDATE ${table} SET title = ?, body = ?, visibility = ?, updated_at = ? WHERE id = ?`,
    [
      patch.title ?? existing.title,
      patch.body ?? existing.body,
      patch.visibility ?? existing.visibility ?? "agent",
      now,
      id
    ]
  );
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new Error("updateKbArticle: reload failed");
  return mapKbArticle(row);
}
async function listKbArticles(db, tenantId, opts) {
  const prefix = opts?.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const limit = opts?.limit ?? 100;
  const clauses = ["tenant_id = ?"];
  const params = [tenantId];
  if (opts?.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.sourceKind) {
    clauses.push("source_kind = ?");
    params.push(opts.sourceKind);
  }
  params.push(limit);
  const rows = await db.all(
    `SELECT * FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
    params
  );
  return rows.map(mapKbArticle);
}
async function getKbArticle(db, tenantId, id, tablePrefix) {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const row = await db.get(
    `SELECT * FROM ${prefix}kb_articles WHERE tenant_id = ? AND id = ?`,
    [tenantId, id]
  );
  return row ? mapKbArticle(row) : void 0;
}
function slugifyHeading(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
async function ingestFromChangelog(db, tenantId, changelogText, opts) {
  const sections = changelogText.split(/\n(?=##\s)/);
  const articles = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^##\s+(.+?)(?:\n|$)/);
    if (!match) continue;
    const heading = match[1].trim();
    const sourceKey = `changelog:${slugifyHeading(heading)}`;
    const ingestInput = {
      tenantId,
      title: heading,
      body: trimmed,
      sourceKey
    };
    if (opts?.gitSha) ingestInput.gitSha = opts.gitSha;
    if (opts?.tablePrefix) ingestInput.tablePrefix = opts.tablePrefix;
    const article = await ingestCodegenArticle(db, ingestInput);
    articles.push(article);
  }
  return articles;
}
async function ingestDocsSources(db, tenantId, sources, opts) {
  const articles = [];
  for (const src of sources) {
    const sourceKey = `docs:${src.path.replace(/^\/+/, "")}`;
    const title = src.title ?? src.path.split("/").pop()?.replace(/\.md$/i, "") ?? src.path;
    const ingestInput = {
      tenantId,
      title,
      body: src.body,
      sourceKey,
      path: src.path
    };
    if (opts?.gitSha) ingestInput.gitSha = opts.gitSha;
    if (opts?.tablePrefix) ingestInput.tablePrefix = opts.tablePrefix;
    articles.push(await ingestCodegenArticle(db, ingestInput));
  }
  return articles;
}

// src/kb/siteCrawl.ts
function safeFetch(fetchImpl, url) {
  return fetchImpl(url, { redirect: "follow" }).then((res) => ({
    ok: res.ok,
    status: res.status,
    text: () => res.text()
  })).catch(() => ({ ok: false, status: 0, text: async () => "" }));
}
function normalizeBase(url) {
  const u = url.trim();
  if (!u) throw new Error("crawlSite: url is required");
  const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  return withProto.replace(/\/+$/, "");
}
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}
function extractLinks(html, base) {
  const origin = new URL(base).origin;
  const out = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (/^#|^javascript:|^mailto:|^tel:/i.test(href)) continue;
    let abs;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue;
    if (!/^https?:$/i.test(abs.protocol)) continue;
    out.push(abs.href);
  }
  return [...new Set(out)];
}
function htmlToText(html) {
  let t = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<nav\b[\s\S]*?<\/nav>/gi, " ").replace(/<footer\b[\s\S]*?<\/footer>/gi, " ").replace(/<[^>]+>/g, " ");
  t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  return t.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}
async function crawlSite(baseUrl, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch ?? fetch);
  const base = normalizeBase(baseUrl);
  const maxPages = opts.maxPages ?? 25;
  let urls = [];
  const sm = await safeFetch(fetchImpl, `${base}/sitemap.xml`);
  if (sm.ok) {
    const xml = await sm.text();
    urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  }
  if (urls.length === 0) {
    const home = await safeFetch(fetchImpl, base);
    if (home.ok) {
      urls = extractLinks(await home.text(), base);
    }
  }
  urls = [...new Set(urls)].slice(0, maxPages);
  const pages = [];
  for (const u of urls) {
    const res = await safeFetch(fetchImpl, u);
    if (!res.ok) continue;
    const html = await res.text();
    pages.push({
      url: u,
      title: extractTitle(html) || u,
      text: htmlToText(html).slice(0, 2e4)
    });
  }
  return pages;
}
var CURATION_SYSTEM = `You are the support knowledge-base curator. Given raw page text, produce ONE support KB article: a concise Q&A.
Rules:
- Stay factual; never invent features or policies not present in the source.
- Body: 1-3 short paragraphs answering the question the page is about.
- Respond ONLY with JSON: {"title": "...", "body": "..."}`;
function parseCurationJson(raw) {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const tryParse = (text) => {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.title !== "string" || typeof parsed.body !== "string") return null;
      return { title: parsed.title, body: parsed.body };
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    const extracted = tryParse(m[0]);
    if (extracted) return extracted;
  }
  return null;
}
async function curateSource(db, tenantId, sourceLabel, content, llm, sourceKey, path, opts) {
  const raw = await llm.complete({
    system: CURATION_SYSTEM,
    user: `Source: ${sourceLabel}

Content:
${content.slice(0, 8e3)}`,
    temperature: 0.2
  });
  const curated = parseCurationJson(raw);
  if (!curated) return null;
  const input = {
    tenantId,
    title: curated.title,
    body: curated.body,
    sourceKey,
    path,
    sourceKind: "curated"
  };
  if (opts.tablePrefix !== void 0) input.tablePrefix = opts.tablePrefix;
  return ingestCodegenArticle(db, input);
}
async function curatePagesToKb(db, tenantId, pages, llm, opts = {}) {
  const articles = [];
  for (const p of pages) {
    const article = await curateSource(
      db,
      tenantId,
      p.url,
      p.text,
      llm,
      `crawl:${p.url}`,
      p.url,
      opts
    );
    if (article) articles.push(article);
  }
  return articles;
}
async function curateDocsToKb(db, tenantId, docs, llm, opts = {}) {
  const articles = [];
  for (const d of docs) {
    if (!d.content?.trim()) continue;
    const article = await curateSource(
      db,
      tenantId,
      `Uploaded file: ${d.name}`,
      d.content,
      llm,
      `upload:${d.name}`,
      d.name,
      opts
    );
    if (article) articles.push(article);
  }
  return articles;
}

export {
  DEFAULT_TABLE_PREFIX,
  ensureSchema,
  ingestCodegenArticle,
  promoteKbArticle,
  deprecateKbArticle,
  updateKbArticle,
  listKbArticles,
  getKbArticle,
  ingestFromChangelog,
  ingestDocsSources,
  crawlSite,
  curatePagesToKb,
  curateDocsToKb
};
