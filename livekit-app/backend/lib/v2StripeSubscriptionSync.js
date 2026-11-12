const db = require('../db/v2Database');
const { getStripeSettings, getStripeClient } = require('./v2StripeSettings');

const DOWNGRADE_STRIPE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired']);
const LIVE_STRIPE_STATUSES = new Set(['active', 'trialing', 'past_due']);
const PLAN_RANK = { free: 0, starter: 1, pro: 2 };

function orgBillingStatusFromStripe(stripeStatus) {
  const s = String(stripeStatus || '').toLowerCase();
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due') return 'past_due';
  if (DOWNGRADE_STRIPE_STATUSES.has(s)) return 'active'; // The local Free plan remains usable.
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
async function applyStripeSubscriptionToOrg(stripeSub, sourceRevision) {
  return db.transaction(async tx => {
    if (sourceRevision) {
      const applied = await tx.get(`INSERT INTO ops_source_revisions(source_id,revision) VALUES(?,?)
        ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision
        WHERE ops_source_revisions.revision<excluded.revision RETURNING revision`, [`subscription-applied:${stripeSub.id}`, sourceRevision]);
      if (!applied) return {ok:true, skipped:'stale_source_revision'};
    }
    const result = await applyStripeSubscriptionWithinTransaction(stripeSub);
    if (result.orgId) {
      const { queueContact } = require('./opsOutbox');
      const members = await tx.all('SELECT user_id FROM v2_org_members WHERE org_id=?', [result.orgId]);
      for (const member of members) await queueContact(tx, member.user_id);
    }
    return result;
  });
}

async function applyStripeSubscriptionWithinTransaction(stripeSub) {
  const stripeSubId = stripeSub.id;
  const customerId =
    typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id || null;
  let orgId = stripeSub.metadata?.org_id ? String(stripeSub.metadata.org_id) : null;
  const price = stripeSub.items?.data?.[0]?.price;
  const priceId = typeof price === 'string' ? price : price?.id;
  const mappedPlan = priceId ? await db.get('SELECT id FROM v2_plans WHERE stripe_price_id = ?', [priceId]) : null;
  const planIdMeta = mappedPlan?.id || null;

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
  if (exists.is_comp === 1) {
    return { ok: true, skipped: 'comp_account' };
  }

  // An unfinished first payment must not replace an existing usable plan.
  if (stripeStatus === 'incomplete') return { ok: true, skipped: 'payment_incomplete' };
  if (!DOWNGRADE_STRIPE_STATUSES.has(stripeStatus) && !planIdMeta) {
    throw new Error('Stripe subscription price is not mapped to a local plan');
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

  try {
    const { ensureCurrentBillingCycle } = require('./v2BillingCycles');
    await ensureCurrentBillingCycle(orgId);
  } catch (e) {
    console.warn('[stripe-sync] billing cycle ensure:', orgId, e.message);
  }

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

// Serializing retrieve + apply prevents one worker from writing an earlier read last.
const subscriptionSyncLocks = new Map();
/** Retrieve current state: event snapshots can arrive out of order. Failures must retry. */
async function reconcileStripeSubscriptionEvent(snapshot) {
  if (!snapshot?.id) throw new Error('Stripe subscription id required');
  const previous = subscriptionSyncLocks.get(snapshot.id) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const settings = await getStripeSettings();
    const stripe = getStripeClient(settings);
    if (!stripe) throw new Error('Stripe subscription reconciliation unavailable');
    const { nextSourceRevision } = require('@rhule/ops-sdk');
    // Allocate before provider I/O, then fence the write: a slower earlier read
    // cannot overwrite a later completed reconciliation from another process.
    const revision = await nextSourceRevision(db, `subscription-fetch:${snapshot.id}`);
    const current = await stripe.subscriptions.retrieve(snapshot.id);
    return applyStripeSubscriptionToOrg(current, revision);
  });
  subscriptionSyncLocks.set(snapshot.id, operation);
  try {
    return await operation;
  } finally {
    if (subscriptionSyncLocks.get(snapshot.id) === operation) subscriptionSyncLocks.delete(snapshot.id);
  }
}

async function applyCheckoutSessionToOrg(session) {
  if (!['paid', 'no_payment_required'].includes(session.payment_status)) {
    return { ok: true, skipped: 'checkout_unpaid' };
  }
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subId) return { ok: false, reason: 'missing_subscription' };
  // Checkout completion is not proof of payment (for example, delayed payment methods).
  // Reconcile the subscription instead of granting access from session metadata.
  return reconcileStripeSubscriptionEvent({ id: subId });
}

module.exports = {
  reconcileStripeSubscriptionEvent,
  applyStripeSubscriptionToOrg,
  applyCheckoutSessionToOrg,
  orgBillingStatusFromStripe,
  resolvePlanIdFromStripe,
  resolvePeriodBounds,
  resolveCancelFlags,
  unixToIso,
};
