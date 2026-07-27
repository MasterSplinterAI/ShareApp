/**
 * Apply SQL migration files in db/migrations/ (Postgres only).
 * Idempotent via schema_migrations table.
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let applied = 0;
  for (const file of files) {
    const id = file;
    const { rows } = await pool.query(
      `SELECT id FROM schema_migrations WHERE id = $1`,
      [id]
    );
    if (rows.length) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
      await client.query('COMMIT');
      applied += 1;
      console.log(`[v2Database] migration applied: ${id}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[v2Database] migration failed: ${id}`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }
  return { applied, total: files.length };
}

module.exports = { runMigrations, MIGRATIONS_DIR };
