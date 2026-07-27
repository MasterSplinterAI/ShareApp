#!/usr/bin/env node
/**
 * One-time: copy rows from a SQLite v2-platform.db into Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node db/importSqliteToPostgres.js [path/to/v2-platform.db]
 *
 * Runs migrations first, then copies tables that exist in both DBs.
 * Skips schema_migrations. Does not truncate — use a fresh DB or truncate first.
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const { runMigrations } = require('./runMigrations');

const SQLITE_PATH =
  process.argv[2] ||
  process.env.V2_DB_PATH ||
  path.join(__dirname, '..', 'v2-platform.db');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

function openSqlite(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function tableExistsPg(pool, name) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return rows.length > 0;
}

async function copyTable(sqliteDb, pool, table) {
  if (!(await tableExistsPg(pool, table))) {
    console.log(`  skip ${table} (not in postgres)`);
    return 0;
  }
  const rows = await sqliteAll(sqliteDb, `SELECT * FROM ${table}`);
  if (!rows.length) {
    console.log(`  ${table}: 0 rows`);
    return 0;
  }
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  let inserted = 0;
  for (const row of rows) {
    const values = cols.map((c) => row[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    try {
      await pool.query(
        `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values
      );
      inserted += 1;
    } catch (err) {
      console.warn(`  ${table} row failed:`, err.message);
    }
  }
  console.log(`  ${table}: ${inserted}/${rows.length}`);
  return inserted;
}

async function main() {
  console.log('SQLite:', SQLITE_PATH);
  console.log('Postgres: (DATABASE_URL set)');

  const pool = new Pool({ connectionString: DATABASE_URL });
  await runMigrations(pool);

  const sqliteDb = await openSqlite(SQLITE_PATH);
  const tables = (
    await sqliteAll(
      sqliteDb,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
  ).map((r) => r.name);

  console.log(`Copying ${tables.length} tables…`);
  let total = 0;
  for (const table of tables) {
    total += await copyTable(sqliteDb, pool, table);
  }

  sqliteDb.close();
  await pool.end();
  console.log(`Done. Inserted ~${total} rows (conflicts skipped).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
