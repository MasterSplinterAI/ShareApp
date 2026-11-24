-- Recall.ai external meeting notetaker settings, provider tracking, and artifact idempotency.

ALTER TABLE v2_external_bot_sessions
  ADD COLUMN IF NOT EXISTS bot_provider TEXT NOT NULL DEFAULT 'worker';

ALTER TABLE v2_external_bot_sessions
  ADD COLUMN IF NOT EXISTS external_bot_id TEXT;

ALTER TABLE v2_external_bot_sessions
  ADD COLUMN IF NOT EXISTS ingested_at TEXT;

CREATE INDEX IF NOT EXISTS idx_v2_bot_sessions_external_bot_id
  ON v2_external_bot_sessions(external_bot_id);

CREATE TABLE IF NOT EXISTS v2_platform_notetaker_settings (
  id TEXT PRIMARY KEY,
  driver_mode TEXT NOT NULL DEFAULT 'auto',
  recall_region TEXT NOT NULL DEFAULT 'us-east-1',
  recall_api_key_enc TEXT,
  recall_webhook_secret_enc TEXT,
  transcript_mode TEXT NOT NULL DEFAULT 'meeting_captions',
  xai_fallback_enabled INTEGER NOT NULL DEFAULT 1,
  delete_recall_media_after_ingest INTEGER NOT NULL DEFAULT 1,
  waiting_room_timeout_sec INTEGER NOT NULL DEFAULT 600,
  everyone_left_timeout_sec INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT,
  updated_by TEXT
);
