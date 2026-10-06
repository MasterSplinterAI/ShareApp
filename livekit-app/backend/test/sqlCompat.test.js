const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toPostgresSql } = require('../db/sqlCompat');

describe('sqlCompat.toPostgresSql', () => {
  it('converts ? placeholders', () => {
    assert.equal(toPostgresSql('SELECT * FROM t WHERE id = ? AND x = ?'), 'SELECT * FROM t WHERE id = $1 AND x = $2');
  });

  it('rewrites IFNULL to COALESCE', () => {
    assert.match(toPostgresSql('SELECT IFNULL(a, 0) FROM t'), /COALESCE\(a, 0\)/);
  });

  it('rewrites INSERT OR IGNORE', () => {
    const out = toPostgresSql('INSERT OR IGNORE INTO t (id) VALUES (?)');
    assert.match(out, /^INSERT INTO t \(id\) VALUES \(\$1\)/);
    assert.match(out, /ON CONFLICT DO NOTHING$/);
  });

  it('rewrites datetime(now)', () => {
    const out = toPostgresSql("UPDATE t SET x = datetime('now') WHERE id = ?");
    assert.match(out, /to_char\(timezone\('utc', now\(\)\)/);
    assert.match(out, /\$1/);
  });

  it('rewrites start of month', () => {
    const out = toPostgresSql("SELECT * FROM t WHERE created_at >= datetime('now', 'start of month')");
    assert.match(out, /date_trunc\('month'/);
  });

  it('rewrites strftime start of month millis', () => {
    const out = toPostgresSql(
      "SELECT CAST(strftime('%s','now','start of month') AS INTEGER) * 1000"
    );
    assert.match(out, /EXTRACT\(EPOCH FROM date_trunc\('month'/);
  });

  it('rewrites AUTOINCREMENT DDL', () => {
    const out = toPostgresSql(
      'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT)'
    );
    assert.match(out, /BIGSERIAL PRIMARY KEY/);
    assert.doesNotMatch(out, /AUTOINCREMENT/);
  });

  it('strips datetime() around columns without timestamp cast', () => {
    const out = toPostgresSql(
      "SELECT * FROM t WHERE datetime(period_start) <= datetime('now')"
    );
    assert.match(out, /period_start\s*<=\s*to_char/);
    assert.doesNotMatch(out, /::timestamp/);
  });

  it('rewrites SQLite date(column) because Postgres has no date(text)', () => {
    const out = toPostgresSql(
      "SELECT date(created_at) AS day, COUNT(DISTINCT date(ue.created_at)) FROM t GROUP BY date(created_at)"
    );
    assert.match(out, /left\(\(created_at\)::text, 10\) AS day/);
    assert.match(out, /COUNT\(DISTINCT left\(\(ue\.created_at\)::text, 10\)\)/);
    assert.match(out, /GROUP BY left\(\(created_at\)::text, 10\)/);
    assert.doesNotMatch(out, /\bdate\s*\(/);
  });
});
