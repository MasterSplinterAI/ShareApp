-- Contacts and 1-on-1 / In-Call Direct Ringing

CREATE TABLE IF NOT EXISTS v2_contacts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  contact_email TEXT NOT NULL,
  contact_name TEXT,
  contact_user_id TEXT REFERENCES v2_users(id) ON DELETE SET NULL,
  preferred_language TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_contacts_owner_email
  ON v2_contacts(owner_user_id, contact_email);

CREATE INDEX IF NOT EXISTS idx_v2_contacts_owner
  ON v2_contacts(owner_user_id);

CREATE TABLE IF NOT EXISTS v2_direct_calls (
  id TEXT PRIMARY KEY,
  caller_user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  caller_name TEXT NOT NULL,
  caller_email TEXT,
  callee_user_id TEXT REFERENCES v2_users(id) ON DELETE SET NULL,
  callee_email TEXT NOT NULL,
  callee_name TEXT,
  meeting_id TEXT NOT NULL REFERENCES v2_meetings(id) ON DELETE CASCADE,
  room_name TEXT NOT NULL,
  join_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ringing',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_direct_calls_callee_user
  ON v2_direct_calls(callee_user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_v2_direct_calls_callee_email
  ON v2_direct_calls(callee_email, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_v2_direct_calls_caller
  ON v2_direct_calls(caller_user_id, created_at);
