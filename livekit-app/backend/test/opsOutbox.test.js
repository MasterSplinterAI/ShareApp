const test = require('node:test'),
  assert = require('node:assert/strict');
require('./supportIsolation').prepareSupportTest();
const db = require('../db/v2Database');
let outbox;
try {
  outbox = require('../lib/opsOutbox');
} catch {}
test('Lalia transaction facade and durable business event outbox', async t => {
  t.after(() => db.close());
  assert.equal(typeof db.transaction, 'function', 'source transaction facade required');
  assert.ok(outbox?.queueCostEvent);
  await db.initDatabase();
  await outbox.ensureOpsOutboxSchema();
  await db.run('DELETE FROM ops_business_outbox');
  await db.run('DELETE FROM ops_source_revisions');
  await db.run('CREATE TABLE IF NOT EXISTS ops_source_fixture(id TEXT PRIMARY KEY)');
  await db.run('DELETE FROM ops_source_fixture');
  await t.test('rollback affects source and outbox; unrelated SQLite work waits rather than enlisting', async () => {
    let start, resume;
    const ready = new Promise(r => start = r),
      gate = new Promise(r => resume = r);
    const held = db.transaction(async tx => {
      await tx.run("INSERT INTO ops_source_fixture VALUES('rolled-back')");
      await outbox.queueCostEvent(tx, {
        id: 900000001,
        total_cost_usd: .003,
        event_type: 'llm',
        provider: 'fixture',
        ts: 1234567890000
      });
      start();
      await gate;
      throw Error('rollback');
    });
    await ready;
    let unrelatedDone = false;
    const unrelated = db.run("INSERT INTO ops_source_fixture VALUES('independent')").then(() => unrelatedDone = true);
    if (!db.isPostgres()) {
      await new Promise(r => setTimeout(r, 20));
      assert.equal(unrelatedDone, false);
    }
    resume();
    await assert.rejects(held, /rollback/);
    await unrelated;
    assert.deepEqual((await db.all('SELECT id FROM ops_source_fixture')).map(r => r.id), ['independent']);
    assert.equal((await db.all('SELECT * FROM ops_business_outbox')).length, 0);
  });
  await t.test('transaction facade reuses connection and source survives offline peer', async () => {
    await db.transaction(async tx => {
      const a = db.isPostgres() ? await tx.get('SELECT pg_backend_pid() AS pid') : null;
      const b = db.isPostgres() ? await db.get('SELECT pg_backend_pid() AS pid') : null;
      if (a) assert.equal(a.pid, b.pid);
      await tx.run("INSERT INTO ops_source_fixture VALUES('committed')");
      await outbox.queueCostEvent(tx, {
        id: 900000002,
        total_cost_usd: .003,
        event_type: 'llm',
        provider: 'fixture',
        ts: 1234567890000
      });
    });
    let now = 100;
    await outbox.createOpsOutboxWorker({
      now: () => now,
      deliver: async () => {
        throw Error('offline');
      }
    }).drain();
    assert.equal((await db.get('SELECT status FROM ops_business_outbox')).status, 'pending');
    now = 100000;
    let delivered = 0;
    const restarted = outbox.createOpsOutboxWorker({
      now: () => now,
      deliver: async e => {
        delivered++;
        assert.equal(e.payload.costMicros, '3000');
        return {
          eventId: e.eventId,
          status: 'applied'
        };
      }
    });
    await Promise.all([restarted.drain(), restarted.drain()]);
    assert.equal(delivered, 1);
  });
  await t.test('actual telemetry, signup and signed webhook routes retain source intents', async () => {
    process.env.COST_EVENT_SECRET = 'isolated-cost-fixture';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_isolated_event_fixture';
    const express = require('express'),
      crypto = require('node:crypto');
    const app = express();
    app.post('/webhook', express.raw({
      type: 'application/json',
      limit: '2mb'
    }), require('../routes/v2/billingWebhook').handleV2BillingWebhook);
    app.use(express.json());
    app.use('/cost', require('../routes/costEvents'));
    app.use('/auth', require('../routes/v2/auth'));
    const server = app.listen(5396, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    try {
      const post = (url, body, headers = {}) => fetch(`http://127.0.0.1:5396${url}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(body)
      });
      const cost = {
        meeting_id: `ops-event-fixture-${crypto.randomUUID()}`,
        event_type: 'livekit_participant_minute',
        units: 1
      };
      assert.equal((await post('/cost', cost, {
        'X-Cost-Secret': 'isolated-cost-fixture'
      })).status, 200);
      const costRow = await db.get('SELECT * FROM meeting_cost_events WHERE meeting_id=? ORDER BY id DESC LIMIT 1',[cost.meeting_id]);
      assert.equal(await db.get('SELECT envelope FROM ops_business_outbox WHERE event_id=?', [`lalia_cost_row_${costRow.id}:1`]), undefined);

      cost.event_type = 'openai_stt_minute';
      assert.equal((await post('/cost', cost, { 'X-Cost-Secret': 'isolated-cost-fixture' })).status, 200);
      const sttRow = await db.get('SELECT * FROM meeting_cost_events WHERE meeting_id=? ORDER BY id DESC LIMIT 1', [cost.meeting_id]);
      const costEnvelope = JSON.parse((await db.get('SELECT envelope FROM ops_business_outbox WHERE event_id=?', [`lalia_cost_row_${sttRow.id}:1`])).envelope);
      assert.equal(costEnvelope.payload.costMicros, '6000');
      const before = (await db.all('SELECT id FROM meeting_cost_events WHERE meeting_id=?',[cost.meeting_id])).length;
      if (db.isPostgres()) await db.run("ALTER TABLE ops_business_outbox ADD CONSTRAINT event_fixture_failure CHECK(event_type<>'usage.accrued') NOT VALID");else await db.run("CREATE TRIGGER event_fixture_failure BEFORE INSERT ON ops_business_outbox WHEN NEW.event_type='usage.accrued' BEGIN SELECT RAISE(ABORT,'fixture outbox failure'); END");
      try {
        assert.equal((await post('/cost', cost, {
          'X-Cost-Secret': 'isolated-cost-fixture'
        })).status, 500);
        assert.equal((await db.all('SELECT id FROM meeting_cost_events WHERE meeting_id=?',[cost.meeting_id])).length, before);
      } finally {
        await db.run(db.isPostgres() ? 'ALTER TABLE ops_business_outbox DROP CONSTRAINT event_fixture_failure' : 'DROP TRIGGER event_fixture_failure');
      }
      const signup = await post('/auth/signup', {
        email: `ops-event-${crypto.randomUUID()}@fixture.invalid`,
        password: 'fixture-password-123',
        displayName: 'Event fixture'
      });
      assert.equal(signup.status, 201, await signup.clone().text());
      const account = await signup.json();
      const contact = JSON.parse((await db.get('SELECT envelope FROM ops_business_outbox WHERE event_id=?', [`contact:${account.user.id}:1`])).envelope);
      assert.equal(contact.payload.memberships.length, 1);
      assert.equal(contact.payload.memberships[0].org_id, account.org.id);
      assert.equal(Object.hasOwn(contact.payload, 'marketingOptIn'), false);
      const orgCount = Number((await db.get('SELECT COUNT(*) AS count FROM v2_organizations')).count);
      const failedEmail = `rollback-${crypto.randomUUID()}@fixture.invalid`;
      if(db.isPostgres()) await db.run("ALTER TABLE ops_business_outbox ADD CONSTRAINT event_fixture_failure CHECK(event_type<>'contact.changed') NOT VALID");
      else await db.run("CREATE TRIGGER event_fixture_failure BEFORE INSERT ON ops_business_outbox WHEN NEW.event_type='contact.changed' BEGIN SELECT RAISE(ABORT,'fixture contact failure'); END");
      try {
        assert.equal((await post('/auth/signup',{email:failedEmail,password:'fixture-password-123'})).status,500);
        assert.equal(await db.get('SELECT id FROM v2_users WHERE email=?',[failedEmail]),undefined);
        assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM v2_organizations')).count),orgCount);
      } finally { await db.run(db.isPostgres()?'ALTER TABLE ops_business_outbox DROP CONSTRAINT event_fixture_failure':'DROP TRIGGER event_fixture_failure'); }
      const {applyStripeSubscriptionToOrg}=require('../lib/v2StripeSubscriptionSync');
      const sub={id:`sub_fixture_ordering_${crypto.randomUUID()}`,status:'canceled',metadata:{org_id:account.org.id},items:{data:[]}};
      await db.run('DELETE FROM ops_source_revisions WHERE source_id=?',[`subscription-applied:${sub.id}`]);
      await applyStripeSubscriptionToOrg(sub,'3');
      const stale=await applyStripeSubscriptionToOrg({...sub,status:'active'},'2');
      assert.equal(stale.skipped,'stale_source_revision');
      assert.equal((await db.get('SELECT status FROM v2_org_subscriptions WHERE org_id=?',[account.org.id])).status,'canceled');
      const event = {
        id: 'evt_signed_fixture',
        created: 1234567890,
        livemode: false,
        api_version: 'fixture',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_fixture',
            currency: 'usd',
            amount_paid: 100,
            total_taxes: [],
            metadata: {
              large: 'x'.repeat(510000)
            }
          }
        }
      };
      await db.run('DELETE FROM ops_verified_stripe_receipts WHERE id=?', [event.id]);
      const raw = JSON.stringify(event),
        ts = Math.floor(Date.now() / 1000);
      const signature = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${ts}.${raw}`).digest('hex');
      assert.equal((await post('/webhook', event, {
        'stripe-signature': 'invalid'
      })).status, 400);
      assert.equal(await db.get('SELECT id FROM ops_verified_stripe_receipts WHERE id=?', [event.id]), undefined);
      const responses = await Promise.all(Array.from({
        length: 4
      }, () => post('/webhook', event, {
        'stripe-signature': `t=${ts},v1=${signature}`
      })));
      for (const response of responses) assert.equal(response.status, 200);
      const receipt = await db.get('SELECT * FROM ops_verified_stripe_receipts WHERE id=?', [event.id]);
      assert.equal(JSON.parse(receipt.payload).data.object.metadata.large.length, 510000);
      assert.equal(receipt.status, 'delivered');
    } finally {
      await new Promise(r => server.close(r));
    }
  });
});
