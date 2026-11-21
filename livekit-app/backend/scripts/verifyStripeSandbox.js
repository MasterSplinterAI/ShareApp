#!/usr/bin/env node
/**
 * Standalone, sandbox-only app integration check. Never loads dotenv or a server.
 * Required environment: STRIPE_SANDBOX_KEY (sk_test_),
 * STRIPE_SANDBOX_STARTER_PRICE_ID, STRIPE_SANDBOX_PRO_PRICE_ID.
 * Run: node scripts/verifyStripeSandbox.js
 *
 * Uses an in-memory local database and creates only dedicated sandbox fixtures.
 * Stripe customer/subscription have no org_id metadata, so deployed webhook
 * handlers cannot associate them with a tenant. Local mapping uses subscription ID.
 * Checkout sessions are never opened/completed; all own open sessions are expired
 * and the own subscription/customer canceled/deleted in finally. Paid sandbox
 * invoices remain as Stripe test audit records. No production database is loaded.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function validateConfig(env) {
  const key = String(env.STRIPE_SANDBOX_KEY || '').trim();
  if (!key.startsWith('sk_test_')) throw new Error('A Stripe sandbox test key (sk_test_) is required');
  const starter = String(env.STRIPE_SANDBOX_STARTER_PRICE_ID || '').trim();
  const pro = String(env.STRIPE_SANDBOX_PRO_PRICE_ID || '').trim();
  if (!starter.startsWith('price_') || !pro.startsWith('price_') || starter === pro) {
    throw new Error('Provide distinct sandbox Starter and Pro price IDs');
  }
  return { key, starter, pro };
}

function assertSandbox(object) {
  assert.equal(object.livemode, false, 'Refusing an object that is not explicitly sandbox-only');
  return object;
}

async function runSandboxVerification(config, { stripe: injectedStripe, report = console.log } = {}) {
  validateConfig({ STRIPE_SANDBOX_KEY: config.key, STRIPE_SANDBOX_STARTER_PRICE_ID: config.starter, STRIPE_SANDBOX_PRO_PRICE_ID: config.pro });
  const dbPath = require.resolve('../db/v2Database');
  if (require.cache[dbPath]) throw new Error('Run this verification in a fresh standalone process');
  delete process.env.DATABASE_URL;
  process.env.V2_DB_PATH = ':memory:';
  process.env.JWT_SECRET_V2 = crypto.randomBytes(32).toString('hex');
  process.env.STRIPE_SECRET_KEY = config.key;
  process.env.STRIPE_ENABLED = 'true';
  process.env.V2_AUTO_CHARGE_ENABLED = 'false';
  process.env.FRONTEND_URL = 'https://example.com';
  const fixtureEmail = 'sandbox-verification@example.invalid';
  process.env.V2_SUPERADMIN_EMAILS = fixtureEmail;
  const stripe = injectedStripe || new (require('stripe'))(config.key);
  const db = require('../db/v2Database');
  const settings = require('../lib/v2StripeSettings');
  // Injection keeps the exact application routes/sync implementation testable offline.
  settings.getStripeClient = () => stripe;
  const { processStripeEvent } = require('../routes/v2/billingWebhook');
  const { assertCanCreateMeeting } = require('../lib/v2Entitlements');
  const router = require('../routes/v2/billing');
  const checks = [];
  const passed = (label) => { checks.push(label); report(`PASS ${label}`); };
  let customer;
  let subscription;
  let orgId;
  let failure;

  async function invoke(path, body = {}) {
    const handler = router.stack.find((entry) => entry.route?.path === path)?.route.stack.at(-1).handle;
    assert.ok(handler, `Missing billing route ${path}`);
    let result;
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { result = { status: this.statusCode, body: value }; return this; },
    };
    await handler({ body, v2Auth: { orgId, role: 'owner', email: fixtureEmail } }, res);
    return result;
  }
  async function localPlan() {
    return db.get('SELECT * FROM v2_org_subscriptions WHERE org_id = ?', [orgId]);
  }
  async function replay(type, object) {
    await processStripeEvent({ id: `evt_local_${crypto.randomUUID()}`, type, data: { object } });
  }

  try {
    for (const id of [config.starter, config.pro]) {
      const price = assertSandbox(await stripe.prices.retrieve(id));
      assert.ok(price.active && price.recurring, 'Prices must be active recurring sandbox prices');
      assert.equal(price.currency, 'usd');
    }
    await db.initDatabase();
    for (const [plan, price] of [['starter', config.starter], ['pro', config.pro]]) {
      await db.run('UPDATE v2_plans SET stripe_price_id = ? WHERE id = ?', [price, plan]);
    }
    customer = assertSandbox(await stripe.customers.create({ description: 'Lalia isolated sandbox integration verification' }));
    const paymentMethod = assertSandbox(await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id }));
    subscription = assertSandbox(await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: config.starter }],
      default_payment_method: paymentMethod.id,
      payment_behavior: 'error_if_incomplete',
      payment_settings: { payment_method_types: ['card'] },
    }));
    assert.equal(subscription.status, 'active');
    assert.ok(!subscription.metadata?.org_id);
    orgId = db.uuid();
    await db.run("INSERT INTO v2_organizations (id, name, billing_status) VALUES (?, ?, 'active')", [orgId, 'Sandbox verification']);
    await db.run(
      "INSERT INTO v2_org_subscriptions (org_id, plan_id, status, stripe_customer_id, stripe_subscription_id) VALUES (?, 'free', 'active', ?, ?)",
      [orgId, customer.id, subscription.id]
    );
    const originalSnapshot = structuredClone(subscription);
    await replay('customer.subscription.created', subscription);
    assert.equal((await localPlan()).plan_id, 'starter');
    assert.equal((await assertCanCreateMeeting(orgId)).ok, true);
    passed('paid Starter subscription grants Starter');

    subscription = assertSandbox(await stripe.subscriptions.update(subscription.id, {
      items: [{ id: subscription.items.data[0].id, price: config.pro }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
    }));
    await replay('customer.subscription.updated', originalSnapshot);
    assert.equal((await localPlan()).plan_id, 'pro');
    passed('actual Pro price overrides stale event plan');

    const portal = await invoke('/portal');
    assert.equal(portal.status, 200);
    assert.ok(portal.body.url.startsWith('https://'));
    passed('existing customer portal opens');
    const duplicate = await invoke('/checkout', { planId: 'starter' });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'subscription_exists');
    passed('paid subscriber cannot create duplicate Checkout subscription');

    subscription = assertSandbox(await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true }));
    await replay('customer.subscription.updated', subscription);
    assert.equal((await localPlan()).cancel_at_period_end, 1);
    assert.equal((await assertCanCreateMeeting(orgId)).ok, true);
    const resumed = await invoke('/resume');
    assert.equal(resumed.status, 200);
    assert.equal((await localPlan()).cancel_at_period_end, 0);
    passed('scheduled cancellation retains access and can resume');

    subscription = assertSandbox(await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false }));
    await replay('customer.subscription.deleted', subscription);
    assert.equal((await localPlan()).plan_id, 'free');
    assert.equal((await assertCanCreateMeeting(orgId)).ok, true);
    passed('final cancellation restores usable Free');
    await replay('customer.subscription.updated', originalSnapshot);
    assert.equal((await localPlan()).plan_id, 'free');
    passed('stale subscription event stays Free');

    const checkouts = await Promise.all([invoke('/checkout', { planId: 'starter' }), invoke('/checkout', { planId: 'starter' })]);
    assert.equal(checkouts[0].status, 200);
    assert.equal(checkouts[1].status, 200);
    assert.equal(checkouts[0].body.sessionId, checkouts[1].body.sessionId);
    passed('parallel checkout reuses one session');
    const replacement = await invoke('/checkout', { planId: 'pro' });
    assert.equal(replacement.status, 200);
    assert.notEqual(replacement.body.sessionId, checkouts[0].body.sessionId);
    const repeated = await invoke('/checkout', { planId: 'pro' });
    assert.equal(repeated.body.sessionId, replacement.body.sessionId);
    const sessions = await stripe.checkout.sessions.list({ customer: customer.id, limit: 100 });
    for (const session of sessions.data) assertSandbox(session);
    assert.equal(sessions.data.filter((session) => session.status === 'open').length, 1);
    assert.equal(sessions.data.find((session) => session.id === checkouts[0].body.sessionId).status, 'expired');
    passed('explicit plan change replaces unpaid checkout without duplicates');
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors = [];
    async function cleanup(label, action) {
      try { await action(); } catch (error) { cleanupErrors.push(`${label}: ${error.message}`); }
    }
    if (customer) {
      await cleanup('expire fixture checkouts', async () => {
        const sessions = await stripe.checkout.sessions.list({ customer: customer.id, status: 'open', limit: 100 });
        for (const session of sessions.data.filter((item) => item.status === 'open')) {
          assertSandbox(session);
          await stripe.checkout.sessions.expire(session.id);
        }
      });
    }
    if (subscription) {
      await cleanup('cancel fixture subscription', async () => {
        const current = assertSandbox(await stripe.subscriptions.retrieve(subscription.id));
        if (!['canceled', 'incomplete_expired'].includes(current.status)) {
          await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
        }
      });
    }
    if (customer) await cleanup('delete fixture customer', () => stripe.customers.del(customer.id));
    if (cleanupErrors.length) {
      failure = new Error([failure?.message, ...cleanupErrors].filter(Boolean).join('; '));
    }
  }
  if (failure) throw failure;
  passed('own sandbox fixtures cleaned up');
  return { ok: true, checks };
}

if (require.main === module) {
  Promise.resolve().then(() => runSandboxVerification(validateConfig(process.env))).then((result) => {
    console.log(JSON.stringify({ ok: result.ok, checksPassed: result.checks.length }));
  }).catch((error) => {
    const message = String(error.message || error).replace(/sk_(?:test|live)_[A-Za-z0-9_]+/g, '[redacted]');
    console.error(`Sandbox verification failed: ${message}`);
    process.exitCode = 1;
  });
}

module.exports = { validateConfig, runSandboxVerification };
