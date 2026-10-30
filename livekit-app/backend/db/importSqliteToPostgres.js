#!/usr/bin/env node
/**
 * One-time: copy rows from a SQLite v2-platform.db into Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node db/importSqliteToPostgres.js [path/to/v2-platform.db]
 *
 * Runs migrations first, then copies tables in FK-safe order.
 * Use --truncate to wipe public app tables before import (keeps schema_migrations).
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const { runMigrations } = require('./runMigrations');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TRUNCATE = process.argv.includes('--truncate');
const SQLITE_PATH =
  args[0] ||
  process.env.V2_DB_PATH ||
  path.join(__dirname, '..', 'v2-platform.db');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

/** Parents before children so FKs succeed. */
const TABLE_ORDER = [
  'v2_users',
  'v2_organizations',
  'v2_plans',
  'v2_org_members',
  'v2_org_subscriptions',
  'v2_billing_cycles',
  'v2_meetings',
  'v2_meeting_policies',
  'v2_meeting_invite_links',
  'v2_meeting_guest_invites',
  'v2_meeting_transcript_lines',
  'v2_meeting_transcript_reports',
  'v2_usage_events',
  'v2_usage_rollups',
  'v2_overage_ledger',
  'v2_files',
  'v2_webhook_events',
  'v2_admin_audit_log',
  'v2_platform_billing_settings',
  'v2_platform_email_settings',
  'v2_platform_storage_settings',
  'v2_resend_inbound_events',
  'v2_announcements',
  'v2_password_resets',
  'v2_user_communication_prefs',
  'v2_consent_events',
  'v2_support_tickets',
  'v2_support_messages',
  'v2_support_proposals',
  'v2_support_knowledge_gaps',
  'v2_stripe_disputes',
  'v2_usage_alert_events',
  'meeting_events',
  'meeting_cost_events',
  'meeting_cost_rollups',
  'screen_share_quality_events',
  'support_tickets',
  'support_messages',
  'support_proposals',
  'support_telegram_draft_sessions',
  'support_knowledge_gaps',
  'support_kb_articles',
  'support_leads',
];

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

async function truncateAppTables(pool, tables) {
  const existing = [];
  for (const t of tables) {
    if (await tableExistsPg(pool, t)) existing.push(`"${t}"`);
  }
  if (!existing.length) return;
  console.log(`Truncating ${existing.length} tables…`);
  await pool.query(`TRUNCATE ${existing.join(', ')} RESTART IDENTITY CASCADE`);
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
  let failed = 0;
  for (const row of rows) {
    const values = cols.map((c) => row[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    try {
      const res = await pool.query(
        `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values
      );
      inserted += res.rowCount || 0;
    } catch (err) {
      failed += 1;
      if (failed <= 3) {
        console.warn(`  ${table} row failed:`, err.message);
      }
    }
  }
  const failNote = failed ? ` (${failed} failed)` : '';
  console.log(`  ${table}: ${inserted}/${rows.length}${failNote}`);
  return inserted;
}

async function main() {
  console.log('SQLite:', SQLITE_PATH);
  console.log('Postgres: (DATABASE_URL set)');

  const pool = new Pool({ connectionString: DATABASE_URL });
  await runMigrations(pool);

  const sqliteDb = await openSqlite(SQLITE_PATH);
  const sqliteTables = (
    await sqliteAll(
      sqliteDb,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
  ).map((r) => r.name);

  const ordered = [
    ...TABLE_ORDER.filter((t) => sqliteTables.includes(t)),
    ...sqliteTables.filter((t) => !TABLE_ORDER.includes(t) && t !== 'schema_migrations'),
  ];

  if (TRUNCATE) {
    await truncateAppTables(pool, ordered);
  }

  console.log(`Copying ${ordered.length} tables…`);
  let total = 0;
  for (const table of ordered) {
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
