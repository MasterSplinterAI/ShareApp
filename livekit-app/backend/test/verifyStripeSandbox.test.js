const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, runSandboxVerification } = require('../scripts/verifyStripeSandbox');

test('sandbox runner refuses live or missing credentials before creating anything', () => {
  assert.throws(() => validateConfig({ STRIPE_SANDBOX_KEY: 'sk_live_do_not_use' }), /test key/);
  assert.throws(() => validateConfig({}), /test key/);
});

test('sandbox runner exercises app mapping and cleans up only its own fixtures', async () => {
  let sub;
  const sessions = [];
  const deleted = [];
  const seenMetadata = [];
  const fake = {
    prices: { retrieve: async (id) => ({ id, livemode: false, active: true, recurring: { interval: 'month' }, currency: 'usd' }) },
    customers: {
      create: async (params) => { seenMetadata.push(params.metadata); return { id: 'cus_fixture', livemode: false }; },
      del: async (id) => { deleted.push(id); return { id, deleted: true }; },
    },
    paymentMethods: { attach: async () => ({ id: 'pm_fixture', livemode: false }) },
    subscriptions: {
      create: async (params) => {
        seenMetadata.push(params.metadata);
        sub = { id: 'sub_fixture', customer: params.customer, status: 'active', livemode: false, metadata: {}, cancel_at_period_end: false,
          items: { data: [{ id: 'si_fixture', price: { id: params.items[0].price } }] } };
        return structuredClone(sub);
      },
      retrieve: async () => structuredClone(sub),
      update: async (id, params) => {
        if ('cancel_at_period_end' in params && 'cancel_at' in params) {
          throw new Error('Received both cancel_at_period_end and cancel_at parameters');
        }
        if (params.items) sub.items.data[0].price.id = params.items[0].price;
        if (params.cancel_at_period_end !== undefined) sub.cancel_at_period_end = params.cancel_at_period_end;
        return structuredClone(sub);
      },
      cancel: async () => { sub.status = 'canceled'; sub.cancel_at_period_end = false; return structuredClone(sub); },
      list: async () => ({ data: sub ? [structuredClone(sub)] : [] }),
    },
    billingPortal: { sessions: { create: async () => ({ id: 'bps_fixture', url: 'https://billing.stripe.com/test_fixture', livemode: false }) } },
    checkout: { sessions: {
      list: async () => ({ data: sessions.map(s => structuredClone(s)).reverse() }),
      create: async (params, options) => {
        assert.ok(options.idempotencyKey);
        const session = { id: `cs_fixture_${sessions.length}`, url: 'https://checkout.stripe.com/test_fixture', livemode: false,
          status: 'open', payment_status: 'unpaid', metadata: params.metadata };
        sessions.push(session);
        return structuredClone(session);
      },
      expire: async (id) => { const session = sessions.find(s => s.id === id); session.status = 'expired'; return structuredClone(session); },
    } },
  };
  const config = validateConfig({ STRIPE_SANDBOX_KEY: 'sk_test_fixture', STRIPE_SANDBOX_STARTER_PRICE_ID: 'price_starter', STRIPE_SANDBOX_PRO_PRICE_ID: 'price_pro' });
  const result = await runSandboxVerification(config, { stripe: fake, report: () => {} });
  assert.ok(result.checks.includes('stale subscription event stays Free'));
  assert.ok(result.checks.includes('parallel checkout reuses one session'));
  assert.deepEqual(deleted, ['cus_fixture']);
  assert.ok(sessions.every(s => s.status === 'expired'));
  assert.ok(seenMetadata.every(m => !m?.org_id));
  assert.equal(sub.status, 'canceled');
});
