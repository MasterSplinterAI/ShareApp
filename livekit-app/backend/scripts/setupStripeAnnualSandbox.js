#!/usr/bin/env node
/**
 * Idempotently provision Sandbox/Test annual Stripe prices ($468/yr Starter, $1,908/yr Pro),
 * store stripe_annual_price_id on v2_plans, and enable monthly<->annual switching in the
 * sandbox Customer Portal configuration.
 *
 * Strictly refuses to run if Stripe is not in TEST mode (livemode === false).
 * Never prints secret keys or webhook signing secrets.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ANNUAL_SPECS = [
  { id: 'starter', nickname: 'Lalia Starter Annual', unitAmount: 46800 },
  { id: 'pro', nickname: 'Lalia Pro Annual', unitAmount: 190800 },
];

function assertSandbox(obj, label = 'Stripe object') {
  assert.ok(obj && typeof obj === 'object', `${label} missing`);
  assert.equal(obj.livemode, false, `Refusing live-mode ${label}`);
  return obj;
}

async function provisionAnnualSandbox({ db, stripe, keyMode }) {
  if (keyMode !== 'test') {
    throw new Error(`Refusing to provision sandbox annual prices while stripeKeyMode=${keyMode} (must be 'test')`);
  }
  assert.ok(stripe, 'Active test Stripe client required');

  const summary = { mode: 'test', plans: {}, portalConfigurationId: null };
  const portalProducts = [];

  for (const spec of ANNUAL_SPECS) {
    const row = await db.get('SELECT * FROM v2_plans WHERE id = ?', [spec.id]);
    if (!row || !row.stripe_price_id) {
      throw new Error(`Plan '${spec.id}' is missing its monthly sandbox stripe_price_id in v2_plans`);
    }
    const monthlyPrice = assertSandbox(await stripe.prices.retrieve(row.stripe_price_id), `${spec.id} monthly price`);
    assert.equal(monthlyPrice.active, true, `${spec.id} monthly price must be active`);
    assert.equal(monthlyPrice.currency, 'usd');
    assert.equal(monthlyPrice.recurring?.interval, 'month');

    const productId = typeof monthlyPrice.product === 'string' ? monthlyPrice.product : monthlyPrice.product?.id;
    assert.ok(productId && productId.startsWith('prod_'), `${spec.id} product ID missing`);

    const existingList = await stripe.prices.list({ product: productId, active: true, limit: 100 });
    let annualPrice = (existingList.data || []).find(
      (p) =>
        p.livemode === false &&
        p.currency === 'usd' &&
        p.type === 'recurring' &&
        p.recurring?.interval === 'year' &&
        (p.recurring?.interval_count || 1) === 1 &&
        p.unit_amount === spec.unitAmount
    );
    let created = false;
    if (!annualPrice) {
      annualPrice = assertSandbox(
        await stripe.prices.create(
          {
            product: productId,
            currency: 'usd',
            unit_amount: spec.unitAmount,
            nickname: spec.nickname,
            recurring: { interval: 'year' },
            metadata: { plan_id: spec.id, billing_interval: 'year' },
          },
          { idempotencyKey: `lalia-sandbox-annual-${spec.id}-${productId}-${spec.unitAmount}-v1` }
        ),
        `${spec.id} annual price`
      );
      created = true;
    }

    await db.run(
      'UPDATE v2_plans SET annual_price_cents = ?, stripe_annual_price_id = ? WHERE id = ?',
      [spec.unitAmount, annualPrice.id, spec.id]
    );

    portalProducts.push({
      product: productId,
      prices: [monthlyPrice.id, annualPrice.id],
    });

    summary.plans[spec.id] = {
      productId,
      monthlyPriceId: monthlyPrice.id,
      annualPriceId: annualPrice.id,
      annualPriceCents: spec.unitAmount,
      created,
    };
  }

  const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 20 });
  const targetConfig =
    (configs.data || []).find((c) => c.livemode === false && c.is_default) ||
    (configs.data || []).find((c) => c.livemode === false);

  if (targetConfig) {
    assertSandbox(targetConfig, 'billing portal configuration');
    const currentSubUpdate = targetConfig.features?.subscription_update || {};
    const updatedPortal = assertSandbox(
      await stripe.billingPortal.configurations.update(targetConfig.id, {
        features: {
          subscription_update: {
            enabled: true,
            default_allowed_updates: ['price'],
            proration_behavior: currentSubUpdate.proration_behavior || 'always_invoice',
            billing_cycle_anchor: currentSubUpdate.billing_cycle_anchor || 'unchanged',
            products: portalProducts,
          },
        },
      }),
      'updated billing portal configuration'
    );
    summary.portalConfigurationId = updatedPortal.id;
  }

  return summary;
}

async function main() {
  const db = require('../db/v2Database');
  const { getStripeSettings, getStripeClient } = require('../lib/v2StripeSettings');
  await db.initDatabase();
  try {
    const settings = await getStripeSettings({ fresh: true });
    const stripe = getStripeClient(settings);
    const result = await provisionAnnualSandbox({
      db,
      stripe,
      keyMode: settings.stripeKeyMode,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[setupStripeAnnualSandbox] FAILED:', err.message);
    process.exit(1);
  });
}

module.exports = { provisionAnnualSandbox, ANNUAL_SPECS };
