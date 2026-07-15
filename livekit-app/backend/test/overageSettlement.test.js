process.env.V2_DB_PATH = process.env.V2_DB_PATH || ':memory:';
process.env.JWT_SECRET_V2 =
  process.env.JWT_SECRET_V2 || 'test-overage-settlement-secret-32chars-min';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/v2Database');
const { ensureCurrentBillingCycle, calendarMonthBounds } = require('../lib/v2BillingCycles');
const { writeOverageLedgerForCycle } = require('../lib/v2OverageLedger');
const { settlePendingOverageForOrgCycle } = require('../lib/v2OverageSettlement');

async function seedOrg({ customMeeting = null, planId = 'starter' } = {}) {
  const orgId = db.uuid();
  const userId = db.uuid();
  await db.run(`INSERT INTO v2_organizations (id, name, billing_status, account_type) VALUES (?,?,?,?)`, [
    orgId,
    'Test Org',
    'active',
    'personal',
  ]);
  await db.run(`INSERT INTO v2_users (id, email, password_hash, display_name) VALUES (?,?,?,?)`, [
    userId,
    `${orgId}@example.com`,
    'x',
    'Tester',
  ]);
  await db.run(`INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)`, [orgId, userId, 'owner']);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
  await db.run(
    `INSERT INTO v2_org_subscriptions
     (org_id, plan_id, status, current_period_start, current_period_end, custom_included_meeting_minutes, overage_auto_charge_opt_in)
     VALUES (?,?,?,?,?,?,?)`,
    [orgId, planId, 'active', start, end, customMeeting, 0]
  );
  return { orgId, userId, start, end };
}

describe('billing cycle rotation', () => {
  before(async () => {
    await db.initDatabase();
  });

  it('creates a current cycle when missing', async () => {
    const { orgId } = await seedOrg();
    const first = await ensureCurrentBillingCycle(orgId);
    assert.equal(first.created, true);
    assert.ok(first.cycle.id);
    const second = await ensureCurrentBillingCycle(orgId);
    assert.equal(second.created, false);
    assert.equal(second.cycle.id, first.cycle.id);
  });

  it('uses Stripe period bounds when subscription linked', async () => {
    const { orgId } = await seedOrg();
    const start = '2026-06-15T00:00:00.000Z';
    const end = '2026-07-15T00:00:00.000Z';
    // Make "now" covered by forcing future end beyond "today" — if today's date is after Jul 15 2026
    // the fixture may fall back to calendar. Prefer end far in the future.
    const farEnd = new Date(Date.now() + 20 * 86400000).toISOString();
    const farStart = new Date(Date.now() - 10 * 86400000).toISOString();
    await db.run(
      `UPDATE v2_org_subscriptions
       SET stripe_subscription_id = ?, current_period_start = ?, current_period_end = ?
       WHERE org_id = ?`,
      ['sub_test_1', farStart, farEnd, orgId]
    );
    const { cycle, source } = await ensureCurrentBillingCycle(orgId);
    assert.equal(source, 'stripe');
    assert.equal(cycle.period_start, farStart);
    assert.equal(cycle.period_end, farEnd);
  });
});

describe('overage ledger custom included', () => {
  it('honors custom_included_meeting_minutes', async () => {
    const { orgId } = await seedOrg({ customMeeting: 500 });
    const closedStart = '2020-01-01T00:00:00.000Z';
    const closedEnd = '2020-01-31T23:59:59.000Z';
    const cycleId = db.uuid();
    await db.run(`INSERT INTO v2_billing_cycles (id, org_id, period_start, period_end) VALUES (?,?,?,?)`, [
      cycleId,
      orgId,
      closedStart,
      closedEnd,
    ]);
    await db.run(
      `INSERT INTO v2_usage_events (id, org_id, event_type, quantity, unit, created_at)
       VALUES (?,?,?,?,?,?)`,
      [db.uuid(), orgId, 'meeting_participant_minute', 520, 'minute', '2020-01-15T12:00:00.000Z']
    );
    const result = await writeOverageLedgerForCycle(orgId, cycleId);
    assert.equal(result.ok, true);
    assert.equal(result.overage.meetingMinutes, 20);
    assert.equal(result.included.meetingMinutes, 500);
    const row = await db.get(
      `SELECT units, status FROM v2_overage_ledger WHERE org_id = ? AND cycle_id = ? AND metric = ?`,
      [orgId, cycleId, 'meeting_minutes_overage']
    );
    assert.ok(row);
    assert.equal(row.units, 20);
    assert.equal(row.status, 'pending');

    // Idempotent second write
    const again = await writeOverageLedgerForCycle(orgId, cycleId);
    assert.deepEqual(again.written, []);
  });
});

describe('settlement opt-in gate', () => {
  it('does not charge when org auto-charge opt-in is off', async () => {
    const { orgId } = await seedOrg({ customMeeting: 10 });
    const cycleId = db.uuid();
    await db.run(`INSERT INTO v2_billing_cycles (id, org_id, period_start, period_end) VALUES (?,?,?,?)`, [
      cycleId,
      orgId,
      '2020-02-01T00:00:00.000Z',
      '2020-02-28T23:59:59.000Z',
    ]);
    await db.run(
      `INSERT INTO v2_usage_events (id, org_id, event_type, quantity, unit, created_at)
       VALUES (?,?,?,?,?,?)`,
      [db.uuid(), orgId, 'meeting_participant_minute', 50, 'minute', '2020-02-10T12:00:00.000Z']
    );
    await db.run(
      `UPDATE v2_org_subscriptions SET stripe_customer_id = ?, overage_auto_charge_opt_in = 0 WHERE org_id = ?`,
      ['cus_test', orgId]
    );
    const result = await settlePendingOverageForOrgCycle(orgId, cycleId);
    assert.equal(result.skipped, 'auto_charge_off');
    const ledger = await db.get(`SELECT status FROM v2_overage_ledger WHERE org_id = ? AND cycle_id = ?`, [
      orgId,
      cycleId,
    ]);
    assert.ok(ledger);
    assert.equal(ledger.status, 'pending');
  });
});

describe('calendarMonthBounds', () => {
  it('returns ordered start/end within the same local month', () => {
    const d = new Date(2026, 6, 15, 12, 0, 0); // July 15 local
    const b = calendarMonthBounds(d);
    assert.ok(new Date(b.start).getTime() < new Date(b.end).getTime());
    assert.equal(new Date(b.start).getMonth(), 6);
    assert.equal(new Date(b.end).getMonth(), 6);
  });
});
