-- Acknowledgements belong to the viewer; call status and history stay intact.
CREATE TABLE IF NOT EXISTS v2_call_history_reads (
  user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL REFERENCES v2_direct_calls(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, call_id)
);
