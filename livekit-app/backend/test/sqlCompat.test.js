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
});
