-- External meeting notetaker (Google Meet & Microsoft Teams bot sessions,
-- S3/local audio recordings, post-call auto-recap preferences, and Phase 2 calendar OAuth).

ALTER TABLE v2_meetings
  ADD COLUMN IF NOT EXISTS meeting_source TEXT NOT NULL DEFAULT 'lalia';

ALTER TABLE v2_meetings
  ADD COLUMN IF NOT EXISTS external_meeting_url TEXT;

ALTER TABLE v2_meetings
  ADD COLUMN IF NOT EXISTS auto_recap_mode TEXT NOT NULL DEFAULT 'host_only';

ALTER TABLE v2_meetings
  ADD COLUMN IF NOT EXISTS recap_language TEXT;

ALTER TABLE v2_meetings
  ADD COLUMN IF NOT EXISTS attendee_emails_json TEXT;

CREATE INDEX IF NOT EXISTS idx_v2_meetings_source
  ON v2_meetings(org_id, meeting_source);

CREATE TABLE IF NOT EXISTS v2_external_bot_sessions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES v2_meetings(id) ON DELETE CASCADE,
  requested_by_user_id TEXT NOT NULL REFERENCES v2_users(id),
  platform TEXT NOT NULL,
  target_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  external_meeting_code TEXT,
  bot_display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  status_detail TEXT,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  claim_token TEXT,
  heartbeat_at TEXT,
  scheduled_for TEXT,
  joined_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  recap_sent_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_v2_bot_sessions_queue
  ON v2_external_bot_sessions(status, scheduled_for, created_at);

CREATE INDEX IF NOT EXISTS idx_v2_bot_sessions_meeting
  ON v2_external_bot_sessions(meeting_id);

CREATE INDEX IF NOT EXISTS idx_v2_bot_sessions_org
  ON v2_external_bot_sessions(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_meeting_recordings (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES v2_meetings(id) ON DELETE CASCADE,
  bot_session_id TEXT REFERENCES v2_external_bot_sessions(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_v2_meeting_recordings_meeting
  ON v2_meeting_recordings(meeting_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_calendar_connections (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_email TEXT NOT NULL,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  auto_join_rule TEXT NOT NULL DEFAULT 'all_with_link',
  sync_cursor TEXT,
  last_synced_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (user_id, provider, account_email)
);

CREATE INDEX IF NOT EXISTS idx_v2_calendar_connections_user
  ON v2_calendar_connections(user_id, status);
