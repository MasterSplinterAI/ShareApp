require('./supportIsolation').prepareSupportTest();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/v2Database');
const { provisionAnnualSandbox } = require('../scripts/setupStripeAnnualSandbox');

before(async () => {
  await db.initDatabase();
});
after(() => db.close());

test('provisionAnnualSandbox refuses live mode and provisions Starter ($468/yr) + Pro ($1,908/yr) sandbox prices idempotently', async () => {
  await db.run('UPDATE v2_plans SET stripe_price_id = ?, stripe_annual_price_id = NULL WHERE id = ?', ['price_starter_m', 'starter']);
  await db.run('UPDATE v2_plans SET stripe_price_id = ?, stripe_annual_price_id = NULL WHERE id = ?', ['price_pro_m', 'pro']);

  await assert.rejects(
    () => provisionAnnualSandbox({ db, stripe: {}, keyMode: 'live' }),
    /Refusing to provision sandbox annual prices/
  );

  const createdPrices = [];
  let portalUpdate = null;
  const mockStripe = {
    prices: {
      retrieve: async (id) => ({
        id,
        livemode: false,
        active: true,
        currency: 'usd',
        recurring: { interval: 'month' },
        product: id === 'price_starter_m' ? 'prod_starter' : 'prod_pro',
      }),
      list: async ({ product }) => ({
        data: createdPrices.filter((p) => p.product === product),
      }),
      create: async (params, opts) => {
        const created = {
          id: params.unit_amount === 46800 ? 'price_starter_yr' : 'price_pro_yr',
          livemode: false,
          active: true,
          type: 'recurring',
          ...params,
          idempotencyKey: opts?.idempotencyKey,
        };
        createdPrices.push(created);
        return created;
      },
    },
    billingPortal: {
      configurations: {
        list: async () => ({
          data: [{ id: 'bpc_sandbox_default', livemode: false, is_default: true, features: { subscription_update: { proration_behavior: 'always_invoice' } } }],
        }),
        update: async (id, params) => {
          portalUpdate = { id, params };
          return { id, livemode: false };
        },
      },
    },
  };

  const first = await provisionAnnualSandbox({ db, stripe: mockStripe, keyMode: 'test' });
  assert.equal(first.plans.starter.annualPriceId, 'price_starter_yr');
  assert.equal(first.plans.starter.created, true);
  assert.equal(first.plans.pro.annualPriceId, 'price_pro_yr');
  assert.equal(first.plans.pro.created, true);
  assert.equal(first.portalConfigurationId, 'bpc_sandbox_default');
  assert.deepEqual(portalUpdate.params.features.subscription_update.products, [
    { product: 'prod_starter', prices: ['price_starter_m', 'price_starter_yr'] },
    { product: 'prod_pro', prices: ['price_pro_m', 'price_pro_yr'] },
  ]);

  const second = await provisionAnnualSandbox({ db, stripe: mockStripe, keyMode: 'test' });
  assert.equal(second.plans.starter.created, false);
  assert.equal(second.plans.pro.created, false);
  assert.equal(createdPrices.length, 2);

  const starterRow = await db.get('SELECT * FROM v2_plans WHERE id = ?', ['starter']);
  const proRow = await db.get('SELECT * FROM v2_plans WHERE id = ?', ['pro']);
  assert.equal(starterRow.stripe_annual_price_id, 'price_starter_yr');
  assert.equal(starterRow.annual_price_cents, 46800);
  assert.equal(proRow.stripe_annual_price_id, 'price_pro_yr');
  assert.equal(proRow.annual_price_cents, 190800);
});
