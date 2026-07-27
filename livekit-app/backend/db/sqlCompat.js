/**
 * Rewrite common SQLite SQL idioms for PostgreSQL.
 * Used when DATABASE_URL is set so existing call sites keep working.
 */

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function toPostgresSql(sql) {
  let s = String(sql);

  // SQLite auto-id → Postgres serial (CREATE TABLE ensure* helpers)
  s = s.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY');

  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(s)) {
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(s)) {
      s = s.replace(/\s*;?\s*$/, ' ON CONFLICT DO NOTHING');
    }
  }

  // INSERT OR REPLACE → upsert on primary key is table-specific; map to ON CONFLICT DO NOTHING
  // for simple test seeds that re-run (tests should prefer DELETE + INSERT). Prefer IGNORE.
  if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(s)) {
    s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(s)) {
      s = s.replace(/\s*;?\s*$/, ' ON CONFLICT DO NOTHING');
    }
  }

  s = s.replace(
    /CAST\s*\(\s*strftime\s*\(\s*'%s'\s*,\s*'now'\s*,\s*'start of month'\s*\)\s+AS\s+INTEGER\s*\)\s*\*\s*1000/gi,
    `(EXTRACT(EPOCH FROM date_trunc('month', timezone('utc', now()))) * 1000)::bigint`
  );

  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'start of month'\s*\)/gi,
    `to_char(date_trunc('month', timezone('utc', now())), 'YYYY-MM-DD HH24:MI:SS')`
  );

  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'start of day'\s*\)/gi,
    `to_char(date_trunc('day', timezone('utc', now())), 'YYYY-MM-DD HH24:MI:SS')`
  );

  // datetime('now', ?) where ? is e.g. '-7 days'
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*\?\s*\)/gi,
    `to_char(timezone('utc', now()) + (?::text)::interval, 'YYYY-MM-DD HH24:MI:SS')`
  );

  s = s.replace(
    /datetime\s*\(\s*'now'\s*\)/gi,
    `to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')`
  );

  // datetime(column) — TEXT ISO timestamps compare lexicographically with to_char(...).
  // Do not cast to timestamp (avoids "timestamp <= text" errors vs datetime('now')).
  s = s.replace(/datetime\s*\(\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)/gi, '$1');

  return convertPlaceholders(s);
}

module.exports = {
  toPostgresSql,
  convertPlaceholders,
};
