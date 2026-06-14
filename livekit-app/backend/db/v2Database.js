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
      account_type TEXT NOT NULL DEFAULT 'personal',
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
      expiry_mode TEXT NOT NULL DEFAULT 'days_after_start',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES v2_meetings(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_invite_meeting ON v2_meeting_invite_links(meeting_id)`);

  const inviteCols = await all(`PRAGMA table_info(v2_meeting_invite_links)`);
  const inviteColNames = new Set((inviteCols || []).map((c) => c.name));
  if (!inviteColNames.has('expiry_mode')) {
    await run(`ALTER TABLE v2_meeting_invite_links ADD COLUMN expiry_mode TEXT NOT NULL DEFAULT 'days_after_start'`);
  }

  await run(`
    CREATE TABLE IF NOT EXISTS v2_meeting_guest_invites (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      invite_link_id TEXT,
      email TEXT NOT NULL,
      invited_by TEXT,
      sent_at TEXT,
      reminder_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES v2_meetings(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_guest_invites_meeting ON v2_meeting_guest_invites(meeting_id)`);

  const polCols = await all(`PRAGMA table_info(v2_meeting_policies)`);
  const polColNames = new Set((polCols || []).map((c) => c.name));
  if (!polColNames.has('store_transcripts')) {
    await run(`ALTER TABLE v2_meeting_policies ADD COLUMN store_transcripts INTEGER NOT NULL DEFAULT 0`);
  }

  await run(`
    CREATE TABLE IF NOT EXISTS v2_meeting_transcript_lines (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      participant_identity TEXT NOT NULL,
      language TEXT,
      source_language TEXT,
      original_text TEXT NOT NULL,
      translated_text TEXT,
      transcription_id TEXT,
      dedupe_key TEXT UNIQUE,
      FOREIGN KEY (meeting_id) REFERENCES v2_meetings(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_transcript_meeting_time ON v2_meeting_transcript_lines(meeting_id, recorded_at)`);

  await run(`
    CREATE TABLE IF NOT EXISTS v2_meeting_transcript_reports (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      custom_instructions TEXT,
      instructions_hash TEXT NOT NULL,
      line_count INTEGER NOT NULL DEFAULT 0,
      content_markdown TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES v2_meetings(id)
    )
  `);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_v2_transcript_reports_meeting ON v2_meeting_transcript_reports(meeting_id, created_at)`
  );

  const cols = await all(`PRAGMA table_info(v2_meetings)`);
  const colNames = new Set((cols || []).map((c) => c.name));
  if (!colNames.has('host_present')) {
    await run(`ALTER TABLE v2_meetings ADD COLUMN host_present INTEGER NOT NULL DEFAULT 1`);
  }

  await run(`
    CREATE TABLE IF NOT EXISTS v2_webhook_events (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'stripe',
      type TEXT NOT NULL,
      payload_json TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS v2_admin_audit_log (
      id TEXT PRIMARY KEY,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_admin_audit_created ON v2_admin_audit_log(created_at)`);

  const usageCols = await all(`PRAGMA table_info(v2_usage_events)`);
  const usageColNames = new Set((usageCols || []).map((c) => c.name));
  if (!usageColNames.has('idempotency_key')) {
    await run(`ALTER TABLE v2_usage_events ADD COLUMN idempotency_key TEXT`);
  }
  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_usage_org_idempotency ON v2_usage_events(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
  );

  const planCols = await all(`PRAGMA table_info(v2_plans)`);
  const planColNames = new Set((planCols || []).map((c) => c.name));
  if (!planColNames.has('stripe_price_id')) {
    await run(`ALTER TABLE v2_plans ADD COLUMN stripe_price_id TEXT`);
  }

  const subCols = await all(`PRAGMA table_info(v2_org_subscriptions)`);
  const subColNames = new Set((subCols || []).map((c) => c.name));
  if (!subColNames.has('is_comp')) {
    await run(`ALTER TABLE v2_org_subscriptions ADD COLUMN is_comp INTEGER NOT NULL DEFAULT 0`);
  }
  if (!subColNames.has('comp_label')) {
    await run(`ALTER TABLE v2_org_subscriptions ADD COLUMN comp_label TEXT`);
  }
  if (!subColNames.has('comp_reason')) {
    await run(`ALTER TABLE v2_org_subscriptions ADD COLUMN comp_reason TEXT`);
  }
  if (!subColNames.has('comp_set_by')) {
    await run(`ALTER TABLE v2_org_subscriptions ADD COLUMN comp_set_by TEXT`);
  }
  if (!subColNames.has('comp_set_at')) {
    await run(`ALTER TABLE v2_org_subscriptions ADD COLUMN comp_set_at TEXT`);
  }

  const orgCols = await all(`PRAGMA table_info(v2_organizations)`);
  const orgColNames = new Set((orgCols || []).map((c) => c.name));
  if (!orgColNames.has('account_type')) {
    await run(`ALTER TABLE v2_organizations ADD COLUMN account_type TEXT NOT NULL DEFAULT 'personal'`);
    const orgRows = await all(`SELECT o.id, o.name, u.email, u.display_name
      FROM v2_organizations o
      LEFT JOIN v2_org_members m ON m.org_id = o.id AND m.role = 'owner'
      LEFT JOIN v2_users u ON u.id = m.user_id`);
    for (const row of orgRows || []) {
      const legacyAuto =
        row.name && row.email && row.name === `${String(row.email).split('@')[0]}'s org`;
      if (legacyAuto) {
        const personalName = (row.display_name || String(row.email).split('@')[0] || 'Account').slice(
          0,
          128
        );
        await run(`UPDATE v2_organizations SET account_type = 'personal', name = ? WHERE id = ?`, [
          personalName,
          row.id,
        ]);
      } else {
        await run(`UPDATE v2_organizations SET account_type = 'team' WHERE id = ?`, [row.id]);
      }
    }
  }
  const orgCols2 = await all(`PRAGMA table_info(v2_organizations)`);
  const orgColNames2 = new Set((orgCols2 || []).map((c) => c.name));
  if (!orgColNames2.has('brand_accent_color')) {
    await run(`ALTER TABLE v2_organizations ADD COLUMN brand_accent_color TEXT`);
  }
  if (!orgColNames2.has('brand_welcome_message')) {
    await run(`ALTER TABLE v2_organizations ADD COLUMN brand_welcome_message TEXT`);
  }
  if (!orgColNames2.has('brand_logo_file')) {
    await run(`ALTER TABLE v2_organizations ADD COLUMN brand_logo_file TEXT`);
  }

  const orgCols3 = await all(`PRAGMA table_info(v2_organizations)`);
  const orgColNames3 = new Set((orgCols3 || []).map((c) => c.name));
  if (!orgColNames3.has('suspended_at')) {
    await run(`ALTER TABLE v2_organizations ADD COLUMN suspended_at TEXT`);
  }
  if (!orgColNames3.has('suspended_reason')) {
    await run(`ALTER TABLE v2_organizations ADD COLUMN suspended_reason TEXT`);
  }

  const userCols = await all(`PRAGMA table_info(v2_users)`);
  const userColNames = new Set((userCols || []).map((c) => c.name));
  if (!userColNames.has('disabled_at')) {
    await run(`ALTER TABLE v2_users ADD COLUMN disabled_at TEXT`);
  }
  if (!userColNames.has('last_login_at')) {
    await run(`ALTER TABLE v2_users ADD COLUMN last_login_at TEXT`);
  }

  const subCols2 = await all(`PRAGMA table_info(v2_org_subscriptions)`);
  const subColNames2 = new Set((subCols2 || []).map((c) => c.name));
  if (!subColNames2.has('custom_included_meeting_minutes')) {
    await run(`ALTER TABLE v2_org_subscriptions ADD COLUMN custom_included_meeting_minutes INTEGER`);
  }
  if (!subColNames2.has('custom_included_translation_minutes')) {
    await run(`ALTER TABLE v2_org_subscriptions ADD COLUMN custom_included_translation_minutes INTEGER`);
  }

  await run(`
    CREATE TABLE IF NOT EXISTS v2_announcements (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      created_by TEXT,
      disabled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_announcements_active ON v2_announcements(starts_at, ends_at)`);

  const planCount = await get(`SELECT COUNT(*) AS c FROM v2_plans`);

  if (!planCount || planCount.c === 0) {
    await run(
      `INSERT INTO v2_plans (id, name, monthly_price_cents, included_meeting_minutes, included_translation_minutes, overage_meeting_cents_per_min, overage_translation_cents_per_min) VALUES (?,?,?,?,?,?,?)`,
      ['free', 'Free', 0, 60, 60, 0, 0]
    );
    await run(
      `INSERT INTO v2_plans (id, name, monthly_price_cents, included_meeting_minutes, included_translation_minutes, overage_meeting_cents_per_min, overage_translation_cents_per_min) VALUES (?,?,?,?,?,?,?)`,
      ['starter', 'Starter', 4900, 2000, 500, 3, 5]
    );
    await run(
      `INSERT INTO v2_plans (id, name, monthly_price_cents, included_meeting_minutes, included_translation_minutes, overage_meeting_cents_per_min, overage_translation_cents_per_min) VALUES (?,?,?,?,?,?,?)`,
      ['pro', 'Pro', 19900, 10000, 3000, 2, 4]
    );
  } else {
    const freePlan = await get(`SELECT id FROM v2_plans WHERE id = 'free'`);
    if (!freePlan) {
      await run(
        `INSERT INTO v2_plans (id, name, monthly_price_cents, included_meeting_minutes, included_translation_minutes, overage_meeting_cents_per_min, overage_translation_cents_per_min) VALUES (?,?,?,?,?,?,?)`,
        ['free', 'Free', 0, 60, 60, 0, 0]
      );
    }
  }

  // Phase 1 cost-tracking tables
  await run(`
    CREATE TABLE IF NOT EXISTS meeting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      org_id TEXT,
      event_type TEXT NOT NULL,
      participant_identity TEXT,
      track_sid TEXT,
      payload_json TEXT,
      ts INTEGER NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_meeting_events_meeting ON meeting_events(meeting_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_meeting_events_org ON meeting_events(org_id)`);
  await run(`
    CREATE TABLE IF NOT EXISTS meeting_cost_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      org_id TEXT,
      event_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      units REAL NOT NULL,
      unit_cost_usd REAL NOT NULL,
      total_cost_usd REAL NOT NULL,
      ts INTEGER NOT NULL,
      meta_json TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_cost_events_meeting ON meeting_cost_events(meeting_id)`);
  await run(`
    CREATE TABLE IF NOT EXISTS meeting_cost_rollups (
      meeting_id TEXT PRIMARY KEY,
      org_id TEXT,
      total_cost_usd REAL NOT NULL,
      breakdown_json TEXT NOT NULL,
      duration_seconds INTEGER,
      computed_at INTEGER NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS screen_share_quality_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      participant_identity TEXT,
      from_layer TEXT,
      to_layer TEXT,
      ts INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS v2_password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES v2_users(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_password_resets_token ON v2_password_resets(token_hash)`);

  await run(`
    CREATE TABLE IF NOT EXISTS v2_user_communication_prefs (
      user_id TEXT PRIMARY KEY,
      marketing_email INTEGER NOT NULL DEFAULT 0,
      marketing_sms INTEGER NOT NULL DEFAULT 0,
      marketing_phone INTEGER NOT NULL DEFAULT 0,
      phone_e164 TEXT,
      prefs_updated_at TEXT,
      policy_version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES v2_users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS v2_consent_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      consent_type TEXT NOT NULL,
      granted INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT,
      policy_version INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES v2_users(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_consent_events_user ON v2_consent_events(user_id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS v2_support_tickets (
      id TEXT PRIMARY KEY,
      public_number INTEGER NOT NULL UNIQUE,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      subject TEXT,
      severity TEXT,
      priority TEXT,
      user_id TEXT,
      org_id TEXT,
      guest_email TEXT,
      context_json TEXT,
      duplicate_of_ticket_id TEXT,
      assigned_to TEXT,
      github_issue_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_support_tickets_status ON v2_support_tickets(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_support_tickets_user ON v2_support_tickets(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_support_tickets_created ON v2_support_tickets(created_at)`);

  await run(`
    CREATE TABLE IF NOT EXISTS v2_support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      author_type TEXT NOT NULL,
      author_id TEXT,
      body TEXT NOT NULL,
      attachments_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES v2_support_tickets(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_v2_support_messages_ticket ON v2_support_messages(ticket_id)`);

  // Scale / ops: billing + webhook + usage tables remain SQLite here; production should migrate
  // high-write paths (webhook_events, usage_events, overage_ledger) to Postgres for concurrency and backups.
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
