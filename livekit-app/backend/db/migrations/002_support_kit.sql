-- Support-kit tables (prefix support_). ensureSchema remains idempotent on top.

CREATE TABLE IF NOT EXISTS support_tickets (
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
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status ON support_tickets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_kind ON support_tickets(tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_user ON support_tickets(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_created ON support_tickets(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_id TEXT,
  body TEXT NOT NULL,
  attachments_json TEXT,
  citation_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(tenant_id, ticket_id);

CREATE TABLE IF NOT EXISTS support_proposals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  summary TEXT NOT NULL,
  body_json TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  telegram_message_id TEXT,
  telegram_chat_id TEXT,
  claimed_by TEXT,
  claimed_at TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  execution_status TEXT,
  execution_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_proposals_ticket ON support_proposals(tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_proposals_status ON support_proposals(tenant_id, status);

CREATE TABLE IF NOT EXISTS support_telegram_draft_sessions (
  telegram_user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  public_number INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_knowledge_gaps (
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
);
CREATE INDEX IF NOT EXISTS idx_support_gaps_status ON support_knowledge_gaps(tenant_id, status);

CREATE TABLE IF NOT EXISTS support_kb_articles (
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
);
CREATE INDEX IF NOT EXISTS idx_support_kb_status ON support_kb_articles(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_support_kb_visibility ON support_kb_articles(tenant_id, visibility);

CREATE TABLE IF NOT EXISTS support_leads (
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
);
CREATE INDEX IF NOT EXISTS idx_support_leads_tenant_email ON support_leads(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_support_leads_marketing ON support_leads(tenant_id, marketing_email_opt_in);
