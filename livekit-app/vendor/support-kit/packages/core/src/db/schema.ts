/**
 * Portable SQLite-oriented DDL. Postgres hosts can run the same CREATE TABLE
 * with minor type tweaks, or map via ensureSchema dialect later.
 */
export function buildSchemaStatements(tablePrefix: string): string[] {
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
  ];
}

/** Columns to ADD if missing (existing installs). SQLite-friendly. */
export function buildAlterStatements(tablePrefix: string): Array<{
  table: string;
  column: string;
  ddl: string;
}> {
  const p = tablePrefix;
  return [
    {
      table: `${p}tickets`,
      column: "kind",
      ddl: `ALTER TABLE ${p}tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'support'`,
    },
    {
      table: `${p}tickets`,
      column: "topic",
      ddl: `ALTER TABLE ${p}tickets ADD COLUMN topic TEXT NOT NULL DEFAULT 'other'`,
    },
    {
      table: `${p}messages`,
      column: "citation_json",
      ddl: `ALTER TABLE ${p}messages ADD COLUMN citation_json TEXT`,
    },
    {
      table: `${p}kb_articles`,
      column: "visibility",
      ddl: `ALTER TABLE ${p}kb_articles ADD COLUMN visibility TEXT NOT NULL DEFAULT 'agent'`,
    },
    {
      table: `${p}proposals`,
      column: "telegram_chat_id",
      ddl: `ALTER TABLE ${p}proposals ADD COLUMN telegram_chat_id TEXT`,
    },
    {
      table: `${p}proposals`,
      column: "claimed_by",
      ddl: `ALTER TABLE ${p}proposals ADD COLUMN claimed_by TEXT`,
    },
    {
      table: `${p}proposals`,
      column: "claimed_at",
      ddl: `ALTER TABLE ${p}proposals ADD COLUMN claimed_at TEXT`,
    },
  ];
}
