const db = require('../db/v2Database');

const DOWNGRADE_STRIPE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired']);
const LIVE_STRIPE_STATUSES = new Set(['active', 'trialing', 'past_due']);
const PLAN_RANK = { free: 0, starter: 1, pro: 2 };

function orgBillingStatusFromStripe(stripeStatus) {
  const s = String(stripeStatus || '').toLowerCase();
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due') return 'past_due';
  if (DOWNGRADE_STRIPE_STATUSES.has(s)) return 'canceled';
  return 'active';
}

function resolvePlanIdFromStripe(stripeSub, planIdMeta) {
  const stripeStatus = String(stripeSub.status || 'active');
  if (DOWNGRADE_STRIPE_STATUSES.has(stripeStatus)) {
    return 'free';
  }
  if (planIdMeta) return planIdMeta;
  return null;
}

function unixToIso(sec) {
  if (sec == null) return null;
  const n = Number(sec);
  if (!Number.isFinite(n)) return null;
  return new Date(Math.floor(n * 1000)).toISOString();
}

/** Newer Stripe API versions put period bounds on subscription items. */
function resolvePeriodBounds(stripeSub) {
  let cps = stripeSub.current_period_start;
  let cpe = stripeSub.current_period_end;
  const item = stripeSub.items?.data?.[0];
  if (cps == null && item?.current_period_start != null) cps = item.current_period_start;
  if (cpe == null && item?.current_period_end != null) cpe = item.current_period_end;
  return { cps: unixToIso(cps), cpe: unixToIso(cpe) };
}

/**
 * Pending cancel: Stripe may set cancel_at_period_end, or cancel_at (scheduled end)
 * while status remains active until the period ends.
 */
function resolveCancelFlags(stripeSub) {
  const stripeStatus = String(stripeSub.status || '').toLowerCase();
  const cancelAtIso = unixToIso(stripeSub.cancel_at);
  const canceledAtIso = unixToIso(stripeSub.canceled_at);
  let cancelAtPeriodEnd = Boolean(stripeSub.cancel_at_period_end);
  if (!cancelAtPeriodEnd && cancelAtIso && ['active', 'trialing', 'past_due'].includes(stripeStatus)) {
    cancelAtPeriodEnd = true;
  }
  return {
    cancelAtPeriodEnd,
    cancelAt: cancelAtIso,
    canceledAt: canceledAtIso,
  };
}

/**
 * Apply Stripe subscription object to local v2_org_subscriptions + v2_organizations.billing_status.
 */
async function applyStripeSubscriptionToOrg(stripeSub) {
  const stripeSubId = stripeSub.id;
  const customerId =
    typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id || null;
  let orgId = stripeSub.metadata?.org_id ? String(stripeSub.metadata.org_id) : null;
  const planIdMeta = stripeSub.metadata?.plan_id ? String(stripeSub.metadata.plan_id) : null;

  const bySub = await db.get(`SELECT org_id, is_comp FROM v2_org_subscriptions WHERE stripe_subscription_id = ?`, [
    stripeSubId,
  ]);
  if (bySub) orgId = bySub.org_id;
  if (!orgId) {
    return { ok: false, reason: 'no_org_mapping' };
  }

  const exists = await db.get(
    `SELECT org_id, is_comp, plan_id, stripe_subscription_id, status FROM v2_org_subscriptions WHERE org_id = ?`,
    [orgId]
  );
  if (!exists) return { ok: false, reason: 'no_local_subscription' };

  const stripeStatus = String(stripeSub.status || 'active').slice(0, 32);
  if (
    exists.is_comp === 1 &&
    ['canceled', 'unpaid', 'past_due', 'incomplete_expired'].includes(stripeStatus)
  ) {
    return { ok: true, skipped: 'comp_account' };
  }

  // Duplicate checkouts: ignore cancel/downgrade events for a non-primary Stripe sub
  // so they don't wipe a higher live plan (e.g. Starter cancel while Pro is still live).
  const primarySubId = exists.stripe_subscription_id || null;
  const isPrimary = !primarySubId || primarySubId === stripeSubId;
  if (!isPrimary && DOWNGRADE_STRIPE_STATUSES.has(stripeStatus)) {
    return { ok: true, skipped: 'non_primary_downgrade', orgId, stripeSubId };
  }
  if (!isPrimary && LIVE_STRIPE_STATUSES.has(stripeStatus)) {
    const incomingRank = PLAN_RANK[planIdMeta] ?? -1;
    const currentRank = PLAN_RANK[exists.plan_id] ?? -1;
    if (incomingRank < currentRank && LIVE_STRIPE_STATUSES.has(String(exists.status || ''))) {
      return { ok: true, skipped: 'lower_tier_duplicate', orgId, stripeSubId };
    }
  }

  const { cps, cpe } = resolvePeriodBounds(stripeSub);
  const { cancelAtPeriodEnd, cancelAt, canceledAt } = resolveCancelFlags(stripeSub);
  const planId = resolvePlanIdFromStripe(stripeSub, planIdMeta);
  const orgBillingStatus = orgBillingStatusFromStripe(stripeStatus);

  if (planId) {
    await db.run(
      `UPDATE v2_org_subscriptions SET
         stripe_subscription_id = ?,
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         status = ?,
         plan_id = ?,
         current_period_start = COALESCE(?, current_period_start),
         current_period_end = COALESCE(?, current_period_end),
         cancel_at_period_end = ?,
         cancel_at = ?,
         canceled_at = ?
       WHERE org_id = ?`,
      [
        stripeSubId,
        customerId,
        stripeStatus,
        planId,
        cps,
        cpe,
        cancelAtPeriodEnd ? 1 : 0,
        cancelAt,
        canceledAt,
        orgId,
      ]
    );
  } else {
    await db.run(
      `UPDATE v2_org_subscriptions SET
         stripe_subscription_id = ?,
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         status = ?,
         current_period_start = COALESCE(?, current_period_start),
         current_period_end = COALESCE(?, current_period_end),
         cancel_at_period_end = ?,
         cancel_at = ?,
         canceled_at = ?
       WHERE org_id = ?`,
      [
        stripeSubId,
        customerId,
        stripeStatus,
        cps,
        cpe,
        cancelAtPeriodEnd ? 1 : 0,
        cancelAt,
        canceledAt,
        orgId,
      ]
    );
  }

  await db.run(`UPDATE v2_organizations SET billing_status = ? WHERE id = ?`, [orgBillingStatus, orgId]);

  return {
    ok: true,
    orgId,
    planId,
    orgBillingStatus,
    stripeStatus,
    cancelAtPeriodEnd,
    cancelAt,
  };
}

async function applyCheckoutSessionToOrg(session) {
  const orgId = session.metadata?.org_id ? String(session.metadata.org_id) : null;
  const planId = session.metadata?.plan_id ? String(session.metadata.plan_id) : null;
  const subId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null;
  const custId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;

  if (!orgId || !custId) return { ok: false, reason: 'missing_metadata' };

  const row = await db.get(`SELECT is_comp FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
  if (row?.is_comp === 1) {
    return { ok: true, skipped: 'comp_account' };
  }

  if (planId) {
    await db.run(
      `UPDATE v2_org_subscriptions SET
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         stripe_subscription_id = COALESCE(?, stripe_subscription_id),
         plan_id = ?,
         status = 'active',
         cancel_at_period_end = 0,
         cancel_at = NULL,
         canceled_at = NULL
       WHERE org_id = ?`,
      [custId, subId, planId, orgId]
    );
    await db.run(`UPDATE v2_organizations SET billing_status = 'active' WHERE id = ?`, [orgId]);
  } else {
    await db.run(
      `UPDATE v2_org_subscriptions SET
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         stripe_subscription_id = COALESCE(?, stripe_subscription_id)
       WHERE org_id = ?`,
      [custId, subId, orgId]
    );
  }

  return { ok: true, orgId, planId };
}

module.exports = {
  applyStripeSubscriptionToOrg,
  applyCheckoutSessionToOrg,
  orgBillingStatusFromStripe,
  resolvePlanIdFromStripe,
  resolvePeriodBounds,
  resolveCancelFlags,
  unixToIso,
};
