const db = require('../db/v2Database');
const { getStripeSettings, getStripeClient, isStripeBillingActive } = require('./v2StripeSettings');
const { applyStripeSubscriptionToOrg } = require('./v2StripeSubscriptionSync');

/**
 * Pull subscription state from Stripe when webhooks may have been missed (e.g. after checkout redirect).
 */
async function reconcileOrgSubscriptionFromStripe(orgId) {
  const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
  if (!sub) return { ok: false, reason: 'no_subscription' };
  if (sub.is_comp === 1) return { ok: true, skipped: 'comp_account', subscription: sub };

  if (!sub.stripe_customer_id) {
    return { ok: true, skipped: 'no_stripe_customer', subscription: sub };
  }

  const settings = await getStripeSettings();
  if (!isStripeBillingActive(settings)) {
    return { ok: true, skipped: 'stripe_inactive', subscription: sub };
  }

  const stripe = getStripeClient(settings);
  let stripeSub = null;

  if (sub.stripe_subscription_id) {
    try {
      stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    } catch (err) {
      if (err?.statusCode !== 404) throw err;
    }
  }

  if (!stripeSub) {
    const list = await stripe.subscriptions.list({
      customer: sub.stripe_customer_id,
      status: 'all',
      limit: 5,
    });
    stripeSub =
      list.data.find((s) => ['active', 'trialing', 'past_due'].includes(String(s.status))) ||
      list.data[0] ||
      null;
  }

  if (!stripeSub) {
    return { ok: true, skipped: 'no_stripe_subscription', subscription: sub };
  }

  await applyStripeSubscriptionToOrg(stripeSub);
  const updated = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
  return { ok: true, reconciled: true, subscription: updated };
}

module.exports = { reconcileOrgSubscriptionFromStripe };
