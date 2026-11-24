-- Support CRM tags, internal account notes, one-time goodwill credits, and admin usage alerts.

ALTER TABLE v2_organizations
  ADD COLUMN IF NOT EXISTS admin_tags_json TEXT;

CREATE TABLE IF NOT EXISTS v2_org_credit_grants (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id) ON DELETE CASCADE,
  grant_type TEXT NOT NULL,
  bonus_meeting_minutes INTEGER NOT NULL DEFAULT 0,
  bonus_translation_minutes INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  stripe_txn_id TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_org_credit_grants_org
  ON v2_org_credit_grants(org_id, created_at);

CREATE TABLE IF NOT EXISTS v2_admin_account_notes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES v2_users(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  author_email TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_admin_notes_org
  ON v2_admin_account_notes(org_id, pinned, created_at);

CREATE TABLE IF NOT EXISTS v2_admin_usage_alerts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id) ON DELETE CASCADE,
  alert_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  notified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_admin_usage_alerts_open
  ON v2_admin_usage_alerts(acknowledged_at, created_at);

CREATE INDEX IF NOT EXISTS idx_v2_admin_usage_alerts_org_day
  ON v2_admin_usage_alerts(org_id, alert_key, created_at);
