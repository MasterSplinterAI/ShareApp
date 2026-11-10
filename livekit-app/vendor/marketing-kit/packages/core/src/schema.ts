export interface MarketingDbAdapter {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const DEFAULT_MARKETING_TABLE_PREFIX = "mkt_";

export function buildMarketingSchemaStatements(prefix = DEFAULT_MARKETING_TABLE_PREFIX): string[] {
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
    `,
  ];
}

export async function ensureMarketingSchema(
  db: MarketingDbAdapter,
  tablePrefix = DEFAULT_MARKETING_TABLE_PREFIX,
): Promise<{ tablePrefix: string; statements: number }> {
  const stmts = buildMarketingSchemaStatements(tablePrefix);
  for (const s of stmts) {
    await db.run(s);
  }
  return { tablePrefix, statements: stmts.length };
}
