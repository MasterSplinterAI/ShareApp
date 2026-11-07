-- Native iOS APNs & PushKit VoIP tokens per user

CREATE TABLE IF NOT EXISTS v2_ios_push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  push_type TEXT NOT NULL DEFAULT 'voip',
  bundle_id TEXT NOT NULL DEFAULT 'cloud.lalia.app',
  environment TEXT NOT NULL DEFAULT 'sandbox',
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_ios_push_tokens_user
  ON v2_ios_push_tokens(user_id);
