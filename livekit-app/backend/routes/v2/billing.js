const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { planAllowsTeamWorkspace } = require('../../lib/v2PlanFeatures');
const { writeOverageLedgerForCycle } = require('../../lib/v2OverageLedger');
const {
  getStripeSettings,
  isStripeBillingActive,
  getStripeClient,
} = require('../../lib/v2StripeSettings');
const { getOverageAutoChargeState, setOverageAutoChargeOptIn } = require('../../lib/v2OrgBillingPrefs');
const { settlePendingOverageForOrgCycle } = require('../../lib/v2OverageSettlement');
const { reconcileOrgSubscriptionFromStripe } = require('../../lib/v2StripeReconcile');

// Serialize an org's local checkout requests; Stripe idempotency also covers retries/workers.
const checkoutLocks = new Map();
async function lockCheckout(orgId) {
  const previous = checkoutLocks.get(orgId) || Promise.resolve();
  let unlock;
  const pending = new Promise((resolve) => { unlock = resolve; });
  checkoutLocks.set(orgId, pending);
  await previous;
  return () => {
    if (checkoutLocks.get(orgId) === pending) checkoutLocks.delete(orgId);
    unlock();
  };
}

function stripeErrorDetails(error) {
  return {
    code: error?.code || error?.type || 'stripe_error',
    message: String(error?.raw?.message || error?.message || 'Stripe request failed')
      .replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]+/g, '[redacted]'),
  };
}

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

router.get('/plans', async (req, res) => {
  try {
    const settings = await getStripeSettings();
    const rows = await db.all(`SELECT * FROM v2_plans ORDER BY monthly_price_cents ASC`);
    const plans = rows.map((planRow) => ({
      ...planRow,
      teamWorkspace: planAllowsTeamWorkspace(planRow.id),
    }));
    res.json({ plans, stripeEnabled: isStripeBillingActive(settings) });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/subscription', requireV2Auth, async (req, res) => {
  try {
    const settings = await getStripeSettings();
    const referer = req.get('Referer') || '';
    const shouldReconcile =
      req.query.reconcile === '1' ||
      req.query.billing === 'success' ||
      req.query.billing === 'portal' ||
      referer.includes('billing=success') ||
      referer.includes('billing=portal') ||
      // Keep local cancel/period state fresh when browsing Settings → Billing
      req.query.section === 'billing';

    if (shouldReconcile) {
      try {
        await reconcileOrgSubscriptionFromStripe(req.v2Auth.orgId);
      } catch (e) {
        console.warn('[v2/billing/subscription] stripe reconcile failed:', e.message);
      }
    }

    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.v2Auth.orgId]);
    const planRow = sub ? await db.get(`SELECT * FROM v2_plans WHERE id = ?`, [sub.plan_id]) : null;
    const plan = planRow
      ? {
          ...planRow,
          teamWorkspace: planAllowsTeamWorkspace(planRow.id),
        }
      : null;
    const overageAutoCharge = await getOverageAutoChargeState(req.v2Auth.orgId);
    res.json({
      subscription: sub,
      plan,
      stripeEnabled: isStripeBillingActive(settings),
      overageAutoCharge,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/overage-auto-charge', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { optIn } = req.body || {};
    if (optIn === undefined) {
      return res.status(400).json({ error: 'optIn required' });
    }
    const result = await setOverageAutoChargeOptIn(req.v2Auth.orgId, req.v2Auth.userId, Boolean(optIn), req);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ overageAutoCharge: result.state });
  } catch (e) {
    console.error('[v2/billing/overage-auto-charge]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/checkout', requireV2Auth, async (req, res) => {
  let release;
  try {
    const settings = await getStripeSettings();
    if (!isStripeBillingActive(settings)) {
      return res.status(400).json({ error: 'billing_not_enabled', code: 'stripe_disabled', message: 'Stripe billing is not enabled' });
    }
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { planId } = req.body || {};
    if (!planId || typeof planId !== 'string') {
      return res.status(400).json({ error: 'planId required' });
    }
    const plan = await db.get(`SELECT * FROM v2_plans WHERE id = ?`, [planId]);
    if (!plan || !plan.stripe_price_id) {
      return res.status(400).json({ error: 'Plan not available for self-serve checkout' });
    }
    if (!String(plan.stripe_price_id).startsWith('price_')) {
      return res.status(400).json({
        error:
          'Plan is misconfigured: stripe_price_id must be a Price ID (price_…), not a Product ID (prod_…). Update it in Admin → Plans.',
        code: 'invalid_stripe_price_id',
      });
    }
    if (planId === 'free') {
      return res.status(400).json({ error: 'Free plan does not require checkout' });
    }

    release = await lockCheckout(req.v2Auth.orgId);
    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.v2Auth.orgId]);
    if (!sub) return res.status(404).json({ error: 'No subscription' });
    if (sub.is_comp === 1) {
      return res.status(400).json({ error: 'Comp accounts cannot change plan via checkout' });
    }

    const stripe = getStripeClient(settings);
    let customerId = sub.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.v2Auth.email,
        metadata: { org_id: req.v2Auth.orgId },
      }, { idempotencyKey: `lalia-customer-${req.v2Auth.orgId}` });
      customerId = customer.id;
      await db.run(`UPDATE v2_org_subscriptions SET stripe_customer_id = ? WHERE org_id = ?`, [
        customerId,
        req.v2Auth.orgId,
      ]);
    }

    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    // Unpaid, paused, and incomplete subscriptions can still recover and must not be duplicated.
    if (subscriptions.has_more || subscriptions.data.some((item) => !['canceled', 'incomplete_expired'].includes(item.status))) {
      return res.status(409).json({ error: 'You already have a subscription. Use Manage in Stripe to change your plan.', code: 'subscription_exists' });
    }
    const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 100 });
    if (sessions.has_more) {
      return res.status(409).json({ error: 'Please manage your billing in Stripe or contact support.', code: 'checkout_history_limit' });
    }
    const openSessions = sessions.data.filter((item) => item.status === 'open');
    if (openSessions.length > 1) {
      return res.status(409).json({ error: 'Multiple checkouts are pending. Please contact support.', code: 'checkout_in_progress' });
    }
    const open = openSessions[0];
    if (open) {
      if (open.metadata?.plan_id === planId) {
        return res.json({ url: open.url, sessionId: open.id });
      }
      if (open.payment_status !== 'unpaid') {
        return res.status(409).json({ error: 'Your previous checkout is being processed. Open billing again shortly.', code: 'checkout_in_progress' });
      }
      // Back/cancel redirects leave Checkout open. Explicitly changing plans replaces
      // that unpaid session so it cannot subsequently create another subscription.
      const expired = await stripe.checkout.sessions.expire(open.id);
      if (expired.status !== 'expired') throw new Error('Previous checkout could not be expired');
    }
    const lastSession = sessions.data[0];
    // A just-completed Checkout can precede the subscription-list response.
    if (lastSession?.status === 'complete' && lastSession.subscription) {
      const id = typeof lastSession.subscription === 'string' ? lastSession.subscription : lastSession.subscription.id;
      const latest = await stripe.subscriptions.retrieve(id);
      if (!['canceled', 'incomplete_expired'].includes(latest.status)) {
        return res.status(409).json({ error: 'Your subscription is already being processed. Open billing again shortly.', code: 'subscription_exists' });
      }
    }
    const base = frontendBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      // Delayed-payment methods need a separate fulfillment policy before enabling.
      payment_method_types: ['card'],
      customer: customerId,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${base}/v2/app/settings?billing=success`,
      cancel_url: `${base}/v2/app/settings?billing=cancel`,
      metadata: { org_id: req.v2Auth.orgId, plan_id: planId },
      subscription_data: {
        metadata: { org_id: req.v2Auth.orgId, plan_id: planId },
      },
    }, { idempotencyKey: `lalia-checkout-${req.v2Auth.orgId}-${lastSession?.id || 'first'}` });

    res.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error('[v2/billing/checkout]', stripeErrorDetails(e));
    const stripeMsg = e?.raw?.message || e?.message || '';
    if (e?.code === 'resource_missing' || /No such price/i.test(stripeMsg)) {
      return res.status(400).json({
        error:
          'Stripe rejected this plan price ID. In Admin → Plans, set stripe_price_id to a Price ID (price_…), not a Product ID (prod_…).',
        code: 'invalid_stripe_price_id',
      });
    }
    res.status(500).json({ error: 'Checkout failed' });
  } finally {
    if (release) release();
  }
});

router.post('/portal', requireV2Auth, async (req, res) => {
  try {
    const settings = await getStripeSettings();
    if (!isStripeBillingActive(settings)) {
      return res.status(503).json({ error: 'Stripe billing is not enabled', code: 'stripe_disabled' });
    }
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.v2Auth.orgId]);
    if (!sub?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer on file' });
    }
    const stripe = getStripeClient(settings);
    const base = frontendBaseUrl();
    const { flow } = req.body || {};
    const returnUrl = `${base}/v2/app/settings?section=billing&billing=portal`;
    const sessionParams = {
      customer: sub.stripe_customer_id,
      return_url: returnUrl,
    };
    if (flow === 'cancel' && sub.stripe_subscription_id) {
      sessionParams.flow_data = {
        type: 'subscription_cancel',
        subscription_cancel: { subscription: sub.stripe_subscription_id },
      };
    }
    const session = await stripe.billingPortal.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (e) {
    console.error('[v2/billing/portal]', stripeErrorDetails(e));
    res.status(500).json({ error: 'Portal failed' });
  }
});

/** Undo a pending cancel (cancel_at / cancel_at_period_end) so the plan renews. */
router.post('/resume', requireV2Auth, async (req, res) => {
  try {
    const settings = await getStripeSettings();
    if (!isStripeBillingActive(settings)) {
      return res.status(503).json({ error: 'Stripe billing is not enabled', code: 'stripe_disabled' });
    }
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.v2Auth.orgId]);
    if (!sub?.stripe_subscription_id) {
      return res.status(400).json({ error: 'No active Stripe subscription to resume' });
    }
    const stripe = getStripeClient(settings);
    const { reconcileStripeSubscriptionEvent } = require('../../lib/v2StripeSubscriptionSync');
    const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    // Stripe rejects these two fields in the same request. Period-end cancellation
    // also populates cancel_at, so use the authoritative boolean to distinguish it.
    const resumeParams = current.cancel_at_period_end || !current.cancel_at
      ? { cancel_at_period_end: false }
      : { cancel_at: '' };
    const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, resumeParams);
    await reconcileStripeSubscriptionEvent(updated);
    const fresh = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.v2Auth.orgId]);
    const planRow = fresh ? await db.get(`SELECT * FROM v2_plans WHERE id = ?`, [fresh.plan_id]) : null;
    res.json({
      ok: true,
      subscription: fresh,
      plan: planRow
        ? { ...planRow, teamWorkspace: planAllowsTeamWorkspace(planRow.id) }
        : null,
    });
  } catch (e) {
    console.error('[v2/billing/resume]', stripeErrorDetails(e));
    res.status(500).json({ error: e.message || 'Failed to resume subscription' });
  }
});

router.post('/settle-dry-run', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { cycleId } = req.body || {};
    let cycle = null;
    if (cycleId) {
      cycle = await db.get(`SELECT * FROM v2_billing_cycles WHERE id = ? AND org_id = ?`, [cycleId, req.v2Auth.orgId]);
    } else {
      cycle = await db.get(
        `SELECT * FROM v2_billing_cycles WHERE org_id = ? ORDER BY datetime(period_start) DESC LIMIT 1`,
        [req.v2Auth.orgId]
      );
    }
    if (!cycle) return res.status(404).json({ error: 'No billing cycle' });
    const plan = await db.get(
      `SELECT p.* FROM v2_plans p JOIN v2_org_subscriptions s ON s.plan_id = p.id WHERE s.org_id = ?`,
      [req.v2Auth.orgId]
    );
    const usage = await db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0) AS m,
         COALESCE(SUM(CASE WHEN event_type = 'translation_minute' THEN quantity ELSE 0 END), 0) AS t
       FROM v2_usage_events
       WHERE org_id = ? AND created_at >= ? AND created_at <= ?`,
      [req.v2Auth.orgId, cycle.period_start, cycle.period_end]
    );
    const overM = Math.max(0, (usage?.m || 0) - (plan?.included_meeting_minutes || 0));
    const overT = Math.max(0, (usage?.t || 0) - (plan?.included_translation_minutes || 0));
    const amountMeeting = Math.round(overM * (plan?.overage_meeting_cents_per_min || 0));
    const amountTrans = Math.round(overT * (plan?.overage_translation_cents_per_min || 0));
    const { persistLedger } = req.body || {};
    let ledger = null;
    if (persistLedger) {
      const settings = await getStripeSettings();
      if (!settings.autoChargeEnabled) {
        return res.status(409).json({ error: 'Overage settlement is disabled; previews cannot persist a ledger.', code: 'platform_auto_charge_off' });
      }
      ledger = await writeOverageLedgerForCycle(req.v2Auth.orgId, cycle.id);
    }
    const overageAutoCharge = await getOverageAutoChargeState(req.v2Auth.orgId);
    res.json({
      dryRun: true,
      cycle,
      included: {
        meetingMinutes: plan?.included_meeting_minutes,
        translationMinutes: plan?.included_translation_minutes,
      },
      usage: { meetingMinutes: usage?.m || 0, translationMinutes: usage?.t || 0 },
      overage: {
        meetingMinutes: overM,
        translationMinutes: overT,
      },
      estimatedChargeCents: amountMeeting + amountTrans,
      overageAutoCharge,
      autoChargeEnabled: overageAutoCharge.effective,
      ledger,
    });
  } catch (e) {
    console.error('[v2/billing/settle-dry-run]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/settle-overages', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { cycleId } = req.body || {};
    let cycle = null;
    if (cycleId) {
      cycle = await db.get(`SELECT * FROM v2_billing_cycles WHERE id = ? AND org_id = ?`, [
        cycleId,
        req.v2Auth.orgId,
      ]);
    } else {
      cycle = await db.get(
        `SELECT * FROM v2_billing_cycles WHERE org_id = ? ORDER BY datetime(period_end) DESC LIMIT 1`,
        [req.v2Auth.orgId]
      );
    }
    if (!cycle) return res.status(404).json({ error: 'No billing cycle' });

    const result = await settlePendingOverageForOrgCycle(req.v2Auth.orgId, cycle.id);
    res.json({ ok: true, cycle, result });
  } catch (e) {
    console.error('[v2/billing/settle-overages]', e);
    res.status(500).json({ error: 'Settlement failed' });
  }
});

module.exports = router;
