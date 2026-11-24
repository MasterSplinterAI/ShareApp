-- Reconstructible scheduling projection; accepted intent data remains atomic in ops_support_pending.
CREATE TABLE IF NOT EXISTS ops_support_retry (
  receipt_id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  next_attempt_at BIGINT NOT NULL,
  lease_token TEXT,
  lease_until BIGINT NOT NULL
);
