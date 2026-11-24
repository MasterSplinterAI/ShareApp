CREATE TABLE IF NOT EXISTS ops_customer_source(source_id TEXT PRIMARY KEY,revision TEXT NOT NULL,sequence BIGINT NOT NULL,deleted INTEGER NOT NULL,payload TEXT NOT NULL);
