/**
 * SQLite persistence for V2 SaaS (users, orgs, meetings, billing, usage, files).
 * File: v2-platform.db next to backend (excluded from rsync deploy deletes via path).
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const DB_PATH = process.env.V2_DB_PATH || path.join(__dirname, '..', 'v2-platform.db');

let db = null;
let initPromise = null;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function uuid() {
  return crypto.randomUUID();
}

async function migrate() {
  await run(`
    CREATE TABLE IF NOT EXISTS v2_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      billing_status TEXT NOT NULL DEFAULT 'trial',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_org_members (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (org_id, user_id),
      FOREIGN KEY (org_id) REFERENCES v2_organizations(id),
      FOREIGN KEY (user_id) REFERENCES v2_users(id)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      monthly_price_cents INTEGER NOT NULL DEFAULT 0,
      included_meeting_minutes INTEGER NOT NULL DEFAULT 0,
      included_translation_minutes INTEGER NOT NULL DEFAULT 0,
      overage_meeting_cents_per_min INTEGER NOT NULL DEFAULT 0,
      overage_translation_cents_per_min INTEGER NOT NULL DEFAULT 0
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_org_subscriptions (
      org_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start TEXT,
      current_period_end TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      FOREIGN KEY (org_id) REFERENCES v2_organizations(id),
      FOREIGN KEY (plan_id) REFERENCES v2_plans(id)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_billing_cycles (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      rolled_up_at TEXT,
      FOREIGN KEY (org_id) REFERENCES v2_organizations(id)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_meetings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      host_user_id TEXT NOT NULL,
      livekit_room_name TEXT NOT NULL UNIQUE,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      scheduled_start TEXT,
      scheduled_end TEXT,
      host_code TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT,
      FOREIGN KEY (org_id) REFERENCES v2_organizations(id),
      FOREIGN KEY (host_user_id) REFERENCES v2_users(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_meetings_org ON v2_meetings(org_id)`);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_usage_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      meeting_id TEXT,
      event_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      unit_cost_micros INTEGER,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES v2_organizations(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_usage_org_time ON v2_usage_events(org_id, created_at)`);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_usage_rollups (
      org_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (org_id, cycle_id, metric),
      FOREIGN KEY (org_id) REFERENCES v2_organizations(id),
      FOREIGN KEY (cycle_id) REFERENCES v2_billing_cycles(id)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_overage_ledger (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      units REAL NOT NULL,
      rate_micros INTEGER NOT NULL,
      amount_micros INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES v2_organizations(id),
      FOREIGN KEY (cycle_id) REFERENCES v2_billing_cycles(id)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_files (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      meeting_id TEXT,
      room_name TEXT,
      stored_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime TEXT,
      size_bytes INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES v2_organizations(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_files_org ON v2_files(org_id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS v2_meeting_policies (
      meeting_id TEXT PRIMARY KEY,
      host_required_to_start INTEGER NOT NULL DEFAULT 0,
      require_invite_token INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES v2_meetings(id)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS v2_meeting_invite_links (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      label TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      reusable INTEGER NOT NULL DEFAULT 0,
      use_count INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES v2_meetings(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_invite_meeting ON v2_meeting_invite_links(meeting_id)`);

  const cols = await all(`PRAGMA table_info(v2_meetings)`);
  const colNames = new Set((cols || []).map((c) => c.name));
  if (!colNames.has('host_present')) {
    await run(`ALTER TABLE v2_meetings ADD COLUMN host_present INTEGER NOT NULL DEFAULT 1`);
  }

  const planCount = await get(`SELECT COUNT(*) AS c FROM v2_plans`);
  if (!planCount || planCount.c === 0) {
    await run(
      `INSERT INTO v2_plans (id, name, monthly_price_cents, included_meeting_minutes, included_translation_minutes, overage_meeting_cents_per_min, overage_translation_cents_per_min) VALUES (?,?,?,?,?,?,?)`,
      ['starter', 'Starter', 4900, 2000, 500, 3, 5]
    );
    await run(
      `INSERT INTO v2_plans (id, name, monthly_price_cents, included_meeting_minutes, included_translation_minutes, overage_meeting_cents_per_min, overage_translation_cents_per_min) VALUES (?,?,?,?,?,?,?)`,
      ['pro', 'Pro', 19900, 10000, 3000, 2, 4]
    );
  }
}

function initDatabase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await new Promise((resolve, reject) => {
      db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          console.error('[v2Database] Failed to open:', err.message);
          reject(err);
        } else resolve();
      });
    });
    await migrate();
    console.log('[v2Database] Ready:', DB_PATH);
  })();
  return initPromise;
}

module.exports = {
  initDatabase,
  DB_PATH,
  run,
  get,
  all,
  uuid,
};
