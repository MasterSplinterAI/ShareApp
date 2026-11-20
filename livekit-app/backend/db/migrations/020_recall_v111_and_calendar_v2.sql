-- Upgrade Recall.ai integration to v1.11 async lifecycle + Recall Calendar V2 + durable webhook idempotency.

ALTER TABLE v2_external_bot_sessions
  ADD COLUMN IF NOT EXISTS external_recording_id TEXT;

ALTER TABLE v2_external_bot_sessions
  ADD COLUMN IF NOT EXISTS external_transcript_id TEXT;

ALTER TABLE v2_external_bot_sessions
  ADD COLUMN IF NOT EXISTS transcript_requested_at TEXT;

ALTER TABLE v2_external_bot_sessions
  ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_v2_bot_sessions_ext_recording
  ON v2_external_bot_sessions(external_recording_id);

CREATE INDEX IF NOT EXISTS idx_v2_bot_sessions_ext_transcript
  ON v2_external_bot_sessions(external_transcript_id);

ALTER TABLE v2_platform_notetaker_settings
  ADD COLUMN IF NOT EXISTS chat_notice_enabled INTEGER NOT NULL DEFAULT 1;

ALTER TABLE v2_platform_notetaker_settings
  ADD COLUMN IF NOT EXISTS chat_notice_text TEXT;

ALTER TABLE v2_platform_notetaker_settings
  ADD COLUMN IF NOT EXISTS calendar_regional_callback_uri TEXT;

ALTER TABLE v2_platform_notetaker_settings
  ADD COLUMN IF NOT EXISTS calendar_setup_id TEXT;

ALTER TABLE v2_calendar_connections
  ADD COLUMN IF NOT EXISTS recall_calendar_id TEXT;

ALTER TABLE v2_calendar_connections
  ADD COLUMN IF NOT EXISTS status_detail TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_calendar_connections_recall_id
  ON v2_calendar_connections(recall_calendar_id)
  WHERE recall_calendar_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS v2_calendar_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  calendar_connection_id TEXT NOT NULL REFERENCES v2_calendar_connections(id) ON DELETE CASCADE,
  recall_event_id TEXT NOT NULL UNIQUE,
  recall_calendar_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  ical_uid TEXT,
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  meeting_url TEXT,
  normalized_meeting_url TEXT,
  meeting_platform TEXT,
  organizer_email TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  recording_override TEXT,
  scheduled_bot_id TEXT,
  bot_session_id TEXT REFERENCES v2_external_bot_sessions(id) ON DELETE SET NULL,
  meeting_id TEXT REFERENCES v2_meetings(id) ON DELETE SET NULL,
  raw_json TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_calendar_events_user_time
  ON v2_calendar_events(user_id, is_deleted, start_time);

CREATE INDEX IF NOT EXISTS idx_v2_calendar_events_cal
  ON v2_calendar_events(recall_calendar_id);

CREATE TABLE IF NOT EXISTS v2_recall_webhook_events (
  webhook_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error_code TEXT
);
