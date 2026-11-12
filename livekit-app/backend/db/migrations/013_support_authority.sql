CREATE TABLE IF NOT EXISTS ops_support_host_fence (business_id TEXT PRIMARY KEY, revision BIGINT NOT NULL, authority_origin TEXT NOT NULL, legacy_disabled INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS ops_support_host_acceptance (business_id TEXT PRIMARY KEY,generation TEXT NOT NULL,closed INTEGER NOT NULL,grant_json TEXT,authority_json TEXT,origin TEXT NOT NULL);
