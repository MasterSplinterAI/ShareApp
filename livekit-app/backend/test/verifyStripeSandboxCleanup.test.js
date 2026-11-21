const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSandboxVerification } = require('../scripts/verifyStripeSandbox');

test('sandbox runner deletes its fixture customer when setup fails', async () => {
  const deleted = [];
  const fake = {
    prices: { retrieve: async (id) => ({ id, livemode: false, active: true, recurring: {}, currency: 'usd' }) },
    customers: {
      create: async () => ({ id: 'cus_cleanup_fixture', livemode: false }),
      del: async (id) => { deleted.push(id); return { id, deleted: true }; },
    },
    paymentMethods: { attach: async () => { throw new Error('simulated setup failure'); } },
    checkout: { sessions: { list: async () => ({ data: [] }) } },
  };
  await assert.rejects(
    runSandboxVerification({ key: 'sk_test_fixture', starter: 'price_starter', pro: 'price_pro' }, { stripe: fake, report: () => {} }),
    /simulated setup failure/
  );
  assert.deepEqual(deleted, ['cus_cleanup_fixture']);
});
