-- Self-hosted LiveKit agent Cloud failover & admin notification settings/events.
CREATE TABLE IF NOT EXISTS v2_platform_alert_settings (
  id TEXT PRIMARY KEY,
  failover_enabled INTEGER NOT NULL DEFAULT 1,
  join_timeout_sec INTEGER NOT NULL DEFAULT 10,
  circuit_cooldown_sec INTEGER NOT NULL DEFAULT 120,
  alert_cooldown_minutes INTEGER NOT NULL DEFAULT 15,
  banner_enabled INTEGER NOT NULL DEFAULT 1,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  email_recipients TEXT,
  telegram_enabled INTEGER NOT NULL DEFAULT 1,
  telegram_bot_token_enc TEXT,
  telegram_chat_id TEXT,
  notify_on_recovery INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS v2_agent_failover_events (
  id TEXT PRIMARY KEY,
  room_name TEXT NOT NULL,
  org_id TEXT,
  event_kind TEXT NOT NULL,
  from_pipeline TEXT NOT NULL,
  to_pipeline TEXT NOT NULL,
  reason TEXT NOT NULL,
  details_json TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_agent_failover_ack_created
  ON v2_agent_failover_events(acknowledged_at, created_at DESC);
