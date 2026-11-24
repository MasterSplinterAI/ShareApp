CREATE TABLE IF NOT EXISTS ops_business_outbox (
   id TEXT PRIMARY KEY,business_id TEXT NOT NULL,environment TEXT NOT NULL,event_type TEXT NOT NULL,event_id TEXT NOT NULL,
   fingerprint TEXT NOT NULL,envelope TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
   next_attempt_at BIGINT NOT NULL DEFAULT 0,lease_token TEXT,lease_until BIGINT NOT NULL DEFAULT 0,
   last_error TEXT,result TEXT,UNIQUE(business_id,environment,event_type,event_id));
CREATE TABLE IF NOT EXISTS ops_source_revisions (source_id TEXT PRIMARY KEY,revision BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS ops_verified_stripe_receipts (
   id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
   attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at BIGINT NOT NULL DEFAULT 0,lease_token TEXT,lease_until BIGINT NOT NULL DEFAULT 0,last_error TEXT);
