const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const tmpDbPath = path.join(os.tmpdir(), `lalia-admin-crm-test-${process.pid}-${Date.now()}.sqlite`);
process.env.DATABASE_URL = '';
process.env.V2_DB_PATH = tmpDbPath;
process.env.JWT_SECRET_V2 = 'test-secret-with-more-than-32-characters-admin-crm';
process.env.V2_SUPERADMIN_EMAILS = 'superadmin@lalia.cloud';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db/v2Database');
const { toPostgresSql } = require('../db/sqlCompat');
const { signSession } = require('../lib/authAdapter');
const { getOrgEntitlements, assertCanCreateMeeting } = require('../lib/v2Entitlements');
const { writeOverageLedgerForCycle } = require('../lib/v2OverageLedger');
const {
  applyStripeBalanceCredit,
  recordAndNotifyAdminUsageAlert,
} = require('../lib/v2AdminOps');
const adminRouter = require('../routes/v2/admin');

async function invokeRouter(router, { method = 'GET', url = '/', headers = {}, body = undefined, query = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      originalUrl: url,
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      body,
      query,
      params: {},
      ip: '127.0.0.1',
      get(name) {
        return this.headers[name.toLowerCase()];
      },
    };
    const resHeaders = {};
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(k, v) {
        resHeaders[k.toLowerCase()] = v;
      },
      getHeader(k) {
        return resHeaders[k.toLowerCase()];
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, headers: resHeaders, body: payload });
      },
      send(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, headers: resHeaders, body: payload });
      },
      end(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, headers: resHeaders, body: payload });
      },
    };
    router.handle(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, headers: resHeaders, body: { error: 'Unhandled route' } });
    });
  });
}

describe('Admin SaaS Command Center, Goodwill Credits, Usage Alerts & Support CRM', () => {
  let adminBearer;
  let adminOrgId;
  let customerOrgId;
  let customerUserId;
  let compOrgId;

  before(async () => {
    await db.initDatabase();
    const nowIso = new Date().toISOString();

    // Seed superadmin user + org
    adminOrgId = db.uuid();
    const adminUserId = db.uuid();
    await db.run(
      `INSERT INTO v2_organizations (id, name, account_type, billing_status, created_at)
       VALUES (?, 'Lalia Ops', 'team', 'active', ?)`,
      [adminOrgId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_users (id, email, password_hash, display_name, created_at)
       VALUES (?, 'superadmin@lalia.cloud', 'hash', 'Super Admin', ?)`,
      [adminUserId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_org_members (org_id, user_id, role, created_at)
       VALUES (?, ?, 'owner', ?)`,
      [adminOrgId, adminUserId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_org_subscriptions (org_id, plan_id, status, is_comp)
       VALUES (?, 'pro', 'active', 1)`,
      [adminOrgId]
    );

    const token = signSession({
      sub: adminUserId,
      email: 'superadmin@lalia.cloud',
      orgId: adminOrgId,
      role: 'owner',
    });
    adminBearer = `Bearer ${token}`;

    // Seed customer org on Free plan (60 included meeting min) with 65 used -> hard_stopped!
    customerOrgId = db.uuid();
    customerUserId = db.uuid();
    await db.run(
      `INSERT INTO v2_organizations (id, name, account_type, billing_status, created_at)
       VALUES (?, 'Acme Legal', 'personal', 'trial', ?)`,
      [customerOrgId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_users (id, email, password_hash, display_name, created_at)
       VALUES (?, 'founder@acmelegal.test', 'hash', 'Acme Founder', ?)`,
      [customerUserId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_org_members (org_id, user_id, role, created_at)
       VALUES (?, ?, 'owner', ?)`,
      [customerOrgId, customerUserId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_org_subscriptions (org_id, plan_id, status, is_comp, stripe_customer_id)
       VALUES (?, 'free', 'active', 0, 'cus_test_acme_123')`,
      [customerOrgId]
    );

    const meetingId = db.uuid();
    await db.run(
      `INSERT INTO v2_meetings (id, org_id, host_user_id, title, status, livekit_room_name, host_code, created_at)
       VALUES (?, ?, ?, 'Client Intake', 'ended', 'room_acme_1', 'HOST1234', ?)`,
      [meetingId, customerOrgId, customerUserId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_usage_events (id, org_id, meeting_id, event_type, quantity, unit, created_at)
       VALUES (?, ?, ?, 'meeting_participant_minute', 65, 'minute', ?)`,
      [db.uuid(), customerOrgId, meetingId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_usage_events (id, org_id, meeting_id, event_type, quantity, unit, created_at)
       VALUES (?, ?, ?, 'translation_minute', 20, 'minute', ?)`,
      [db.uuid(), customerOrgId, meetingId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_usage_events (id, org_id, meeting_id, event_type, quantity, unit, created_at)
       VALUES (?, ?, ?, 'notetaker_minutes', 15, 'minute', ?)`,
      [db.uuid(), customerOrgId, meetingId, nowIso]
    );

    // Seed comp org with high infra cost ($4.50) to verify high_comp_cost watchlist detection
    compOrgId = db.uuid();
    await db.run(
      `INSERT INTO v2_organizations (id, name, account_type, billing_status, created_at)
       VALUES (?, 'Heavy Comp Partner', 'team', 'active', ?)`,
      [compOrgId, nowIso]
    );
    await db.run(
      `INSERT INTO v2_org_subscriptions (org_id, plan_id, status, is_comp, comp_label)
       VALUES (?, 'pro', 'active', 1, 'promo')`,
      [compOrgId]
    );
    await db.run(
      `INSERT INTO meeting_cost_rollups (meeting_id, org_id, total_cost_usd, breakdown_json, duration_seconds, computed_at)
       VALUES ('room_comp_heavy', ?, 4.5, '{}', 3600, ?)`,
      [compOrgId, Date.now()]
    );
  });

  after(async () => {
    await db.close?.();
    await fsp.rm(tmpDbPath, { force: true }).catch(() => {});
  });

  it('rewrites SQLite datetime offset literals cleanly for PostgreSQL via sqlCompat', () => {
    const sql = `SELECT
      SUM(CASE WHEN created_at >= datetime('now', 'start of day') THEN 1 ELSE 0 END) AS d1,
      SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS d7,
      SUM(CASE WHEN created_at >= datetime('now', '-60 days') AND created_at < datetime('now', '-30 days') THEN 1 ELSE 0 END) AS prev30,
      date(created_at) AS day
      FROM v2_users WHERE created_at >= datetime('now', ?)`;
    const pgSql = toPostgresSql(sql);
    assert.equal(/\bdatetime\s*\(/i.test(pgSql), false, `Expected no raw datetime(...) in Postgres SQL: ${pgSql}`);
    assert.match(pgSql, /\('-7 days'\)::interval/);
    assert.match(pgSql, /\('-30 days'\)::interval/);
    assert.match(pgSql, /\(\$1::text\)::interval/);
    assert.match(pgSql, /left\(\(created_at\)::text, 10\)/);
  });

  it('serves GET /api/v2/admin/dashboard with signups, platform minutes, recent signups, and watchlist', async () => {
    const res = await invokeRouter(adminRouter, {
      method: 'GET',
      url: '/dashboard',
      headers: { authorization: adminBearer },
      query: { days: '14' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.growth.totalUsers >= 2);
    assert.ok(res.body.growth.newSignupsToday >= 2);
    assert.ok(res.body.growth.newSignups7d >= 2);
    assert.equal(res.body.usage.mtdMeetingMinutes, 65);
    assert.equal(res.body.usage.mtdTranslationMinutes, 20);
    assert.equal(res.body.usage.mtdNotetakerMinutes, 15);
    assert.ok(Array.isArray(res.body.recentSignups));
    assert.ok(res.body.recentSignups.some((u) => u.email === 'founder@acmelegal.test'));

    const acmeWatch = res.body.watchlist.find((w) => w.org_id === customerOrgId);
    assert.ok(acmeWatch, 'Expected hard-stopped Acme org on watchlist');
    assert.equal(acmeWatch.primary_flag, 'hard_stopped');

    const compWatch = res.body.watchlist.find((w) => w.org_id === compOrgId);
    assert.ok(compWatch, 'Expected high-spend comp org on watchlist');
    assert.equal(compWatch.primary_flag, 'high_comp_cost');
  });

  it('grants bonus minutes, unblocks hard-capped orgs, prevents overage ledger charges, and revokes cleanly', async () => {
    // Before bonus grant: Free plan has 60m included, 65m used -> hard_cap_meeting
    const blockedGate = await assertCanCreateMeeting(customerOrgId);
    assert.equal(blockedGate.ok, false);
    assert.equal(blockedGate.code, 'hard_cap_meeting');

    // Grant +120 meeting min & +60 translation min via admin endpoint
    const grantRes = await invokeRouter(adminRouter, {
      method: 'POST',
      url: `/orgs/${customerOrgId}/credits/minutes`,
      headers: { authorization: adminBearer },
      body: {
        meetingMinutes: 120,
        translationMinutes: 60,
        expiresInDays: 30,
        reason: 'Goodwill top-up after product demo',
      },
    });
    assert.equal(grantRes.status, 200);
    assert.equal(grantRes.body.ok, true);
    const grantId = grantRes.body.grant.id;

    // Entitlements now include +120 bonus meeting minutes (60 + 120 = 180)
    const entAfter = await getOrgEntitlements(customerOrgId);
    assert.equal(entAfter.baseIncludedMeetingMinutes, 60);
    assert.equal(entAfter.bonusMeetingMinutes, 120);
    assert.equal(entAfter.includedMeetingMinutes, 180);

    // Org is now unblocked to create/join meetings!
    const unblockedGate = await assertCanCreateMeeting(customerOrgId);
    assert.equal(unblockedGate.ok, true);

    // Closed billing cycle overage check: 65m used <= 180m effective included -> 0 overage written
    const cycleId = db.uuid();
    const startIso = new Date(Date.now() - 86400_000).toISOString();
    const endIso = new Date(Date.now() + 86400_000).toISOString();
    await db.run(
      `INSERT INTO v2_billing_cycles (id, org_id, period_start, period_end)
       VALUES (?, ?, ?, ?)`,
      [cycleId, customerOrgId, startIso, endIso]
    );
    const ledgerRes = await writeOverageLedgerForCycle(customerOrgId, cycleId);
    assert.equal(ledgerRes.ok, true);
    assert.equal(ledgerRes.overage.meetingMinutes, 0);

    // Revoke the grant -> cap returns to 60m and org is hard-stopped again
    const revokeRes = await invokeRouter(adminRouter, {
      method: 'POST',
      url: `/orgs/${customerOrgId}/credits/${grantId}/revoke`,
      headers: { authorization: adminBearer },
      body: { reason: 'Testing grant revocation' },
    });
    assert.equal(revokeRes.status, 200);

    const gateAfterRevoke = await assertCanCreateMeeting(customerOrgId);
    assert.equal(gateAfterRevoke.ok, false);
    assert.equal(gateAfterRevoke.code, 'hard_cap_meeting');
  });

  it('applies Stripe customer balance credit ($) and waives pending overage ledger rows', async () => {
    let capturedCustomerId = null;
    let capturedPayload = null;
    const fakeStripe = {
      customers: {
        async createBalanceTransaction(custId, payload) {
          capturedCustomerId = custId;
          capturedPayload = payload;
          return { id: 'cbtxn_test_999', ending_balance: -1500 };
        },
      },
    };

    const stripeCreditRes = await applyStripeBalanceCredit({
      orgId: customerOrgId,
      amountCents: 1500,
      reason: 'Service goodwill credit $15',
      actorEmail: 'superadmin@lalia.cloud',
      stripeClientOverride: fakeStripe,
    });
    assert.equal(stripeCreditRes.ok, true);
    assert.equal(capturedCustomerId, 'cus_test_acme_123');
    assert.equal(capturedPayload.amount, -1500);
    assert.equal(capturedPayload.currency, 'usd');

    // Seed a pending overage row and waive it via admin endpoint
    const cycleId2 = db.uuid();
    await db.run(
      `INSERT INTO v2_billing_cycles (id, org_id, period_start, period_end)
       VALUES (?, ?, '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z')`,
      [cycleId2, customerOrgId]
    );
    await db.run(
      `INSERT INTO v2_overage_ledger (id, org_id, cycle_id, metric, units, rate_micros, amount_micros, status, created_at)
       VALUES (?, ?, ?, 'meeting_minutes_overage', 50, 20000, 1000000, 'pending', datetime('now'))`,
      [db.uuid(), customerOrgId, cycleId2]
    );

    const waiveRes = await invokeRouter(adminRouter, {
      method: 'POST',
      url: `/orgs/${customerOrgId}/credits/waive-overage`,
      headers: { authorization: adminBearer },
      body: { reason: 'Waived first-month accidental overage' },
    });
    assert.equal(waiveRes.status, 200);
    assert.equal(waiveRes.body.waivedCount, 1);
    assert.equal(waiveRes.body.waivedCents, 100);

    const remainingPending = await db.all(
      `SELECT * FROM v2_overage_ledger WHERE org_id = ? AND status IN ('pending', 'pending_payment')`,
      [customerOrgId]
    );
    assert.equal(remainingPending.length, 0);
  });

  it('persists CRM tags, internal pinned notes, usage alert notifications/acknowledgements, and owner email', async () => {
    // 1. Set CRM tags
    const tagRes = await invokeRouter(adminRouter, {
      method: 'PATCH',
      url: `/orgs/${customerOrgId}/tags`,
      headers: { authorization: adminBearer },
      body: { tags: ['VIP', 'Pilot Partner', 'vip'], reason: 'VIP law firm pilot' },
    });
    assert.equal(tagRes.status, 200);
    assert.deepEqual(tagRes.body.tags, ['vip', 'pilot-partner']);

    // 2. Add, unpin/pin, and delete internal notes
    const noteRes = await invokeRouter(adminRouter, {
      method: 'POST',
      url: `/orgs/${customerOrgId}/notes`,
      headers: { authorization: adminBearer },
      body: { body: 'Promised 30-day pilot onboarding check-in.', pinned: true },
    });
    assert.equal(noteRes.status, 200);
    assert.equal(noteRes.body.note.pinned, 1);
    const noteId = noteRes.body.note.id;

    // Verify GET /orgs and GET /orgs/:orgId expose tags, notes, credits, and quota_pct
    const listRes = await invokeRouter(adminRouter, {
      method: 'GET',
      url: '/orgs',
      headers: { authorization: adminBearer },
    });
    assert.equal(listRes.status, 200);
    const acmeRow = listRes.body.orgs.find((o) => o.id === customerOrgId);
    assert.deepEqual(acmeRow.admin_tags, ['vip', 'pilot-partner']);
    assert.equal(Number(acmeRow.note_count), 1);
    assert.ok(acmeRow.quota_pct >= 100);

    const detailRes = await invokeRouter(adminRouter, {
      method: 'GET',
      url: `/orgs/${customerOrgId}`,
      headers: { authorization: adminBearer },
    });
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.notes.length, 1);
    assert.ok(detailRes.body.credits.length >= 2);

    const unpinRes = await invokeRouter(adminRouter, {
      method: 'PATCH',
      url: `/orgs/${customerOrgId}/notes/${noteId}`,
      headers: { authorization: adminBearer },
      body: { pinned: false },
    });
    assert.equal(unpinRes.status, 200);
    assert.equal(unpinRes.body.note.pinned, 0);

    const delNoteRes = await invokeRouter(adminRouter, {
      method: 'DELETE',
      url: `/orgs/${customerOrgId}/notes/${noteId}`,
      headers: { authorization: adminBearer },
    });
    assert.equal(delNoteRes.status, 200);

    // 3. Record high-usage admin alert & acknowledge via endpoint
    const alertRes = await recordAndNotifyAdminUsageAlert({
      orgId: customerOrgId,
      orgName: 'Acme Legal',
      planId: 'starter',
      planName: 'Starter',
      meter: 'meeting',
      kind: 'hard_stopped',
      meterStateRow: { used: 65, included: 60, hardCap: 60, pctIncluded: 108 },
      sendEmailFn: async () => ({ sent: true }),
      sendTelegramFn: async () => ({ sent: true, messageId: 1 }),
    });
    assert.equal(alertRes.ok, true);

    // Same-day duplicate is deduped
    const dupRes = await recordAndNotifyAdminUsageAlert({
      orgId: customerOrgId,
      orgName: 'Acme Legal',
      planId: 'starter',
      planName: 'Starter',
      meter: 'meeting',
      kind: 'hard_stopped',
      meterStateRow: { used: 65, included: 60, hardCap: 60, pctIncluded: 108 },
    });
    assert.equal(dupRes.deduped, true);

    const ackRes = await invokeRouter(adminRouter, {
      method: 'POST',
      url: '/usage-alerts/acknowledge',
      headers: { authorization: adminBearer },
      body: {},
    });
    assert.equal(ackRes.status, 200);
    assert.ok(ackRes.body.acknowledgedCount >= 1);

    // 4. Transactional org owner email with purpose: 'account_notice'
    const emailRes = await invokeRouter(adminRouter, {
      method: 'POST',
      url: `/orgs/${customerOrgId}/email`,
      headers: { authorization: adminBearer },
      body: {
        purpose: 'account_notice',
        subject: 'Your Lalia workspace quota update',
        body: 'We added bonus minutes to your workspace.',
        reason: 'Follow-up after granting bonus minutes',
      },
    });
    assert.equal(emailRes.status, 200);
    assert.equal(emailRes.body.ok, true);
    assert.deepEqual(emailRes.body.recipients, ['founder@acmelegal.test']);
  });
});
