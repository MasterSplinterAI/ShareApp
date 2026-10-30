const db = require('../db/v2Database');
const { getStripeSettings, getStripeClient, isStripeBillingActive } = require('./v2StripeSettings');
const { applyStripeSubscriptionToOrg } = require('./v2StripeSubscriptionSync');

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);
const PLAN_RANK = { free: 0, starter: 1, pro: 2 };

function planRankFromStripeSub(stripeSub) {
  const meta = stripeSub?.metadata?.plan_id ? String(stripeSub.metadata.plan_id) : '';
  if (PLAN_RANK[meta] != null) return PLAN_RANK[meta];
  // Prefer higher $ as a weak fallback when metadata is missing
  const amount = Number(stripeSub?.items?.data?.[0]?.price?.unit_amount || 0);
  return Number.isFinite(amount) ? amount / 100000 : 0;
}

/** Prefer live/high-tier sub when a customer has accidental duplicate checkouts. */
function pickPreferredStripeSubscription(list, preferredSubId) {
  const rows = Array.isArray(list) ? list : [];
  if (preferredSubId) {
    const preferred = rows.find((s) => s.id === preferredSubId);
    if (preferred && LIVE_STATUSES.has(String(preferred.status))) return preferred;
  }
  const live = rows.filter((s) => LIVE_STATUSES.has(String(s.status)));
  if (live.length) {
    live.sort((a, b) => {
      const rankDiff = planRankFromStripeSub(b) - planRankFromStripeSub(a);
      if (rankDiff !== 0) return rankDiff;
      return Number(b.created || 0) - Number(a.created || 0);
    });
    return live[0];
  }
  if (preferredSubId) {
    const preferred = rows.find((s) => s.id === preferredSubId);
    if (preferred) return preferred;
  }
  return rows[0] || null;
}

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

  const list = await stripe.subscriptions.list({
    customer: sub.stripe_customer_id,
    status: 'all',
    limit: 20,
  });

  stripeSub = pickPreferredStripeSubscription(list.data, sub.stripe_subscription_id);

  // If preferred id wasn't in the page but still exists (rare), retrieve it when live preferred missing
  if (!stripeSub && sub.stripe_subscription_id) {
    try {
      stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    } catch (err) {
      if (err?.statusCode !== 404) throw err;
    }
  }

  if (!stripeSub) {
    return { ok: true, skipped: 'no_stripe_subscription', subscription: sub };
  }

  await applyStripeSubscriptionToOrg(stripeSub);
  const updated = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
  return { ok: true, reconciled: true, subscription: updated };
}

module.exports = {
  reconcileOrgSubscriptionFromStripe,
  pickPreferredStripeSubscription,
  planRankFromStripeSub,
};
