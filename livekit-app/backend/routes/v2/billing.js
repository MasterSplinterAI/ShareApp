const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { planAllowsTeamWorkspace } = require('../../lib/v2PlanFeatures');
const { writeOverageLedgerForCycle } = require('../../lib/v2OverageLedger');

function stripeEnabled() {
  return process.env.STRIPE_ENABLED === 'true' && Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripe() {
  if (!stripeEnabled()) return null;
  // eslint-disable-next-line global-require
  const Stripe = require('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

router.get('/plans', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM v2_plans ORDER BY monthly_price_cents ASC`);
    const plans = rows.map((planRow) => ({
      ...planRow,
      teamWorkspace: planAllowsTeamWorkspace(planRow.id),
    }));
    res.json({ plans, stripeEnabled: stripeEnabled() });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/subscription', requireV2Auth, async (req, res) => {
  try {
    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.v2Auth.orgId]);
    const planRow = sub ? await db.get(`SELECT * FROM v2_plans WHERE id = ?`, [sub.plan_id]) : null;
    const plan = planRow
      ? {
          ...planRow,
          teamWorkspace: planAllowsTeamWorkspace(planRow.id),
        }
      : null;
    res.json({ subscription: sub, plan, stripeEnabled: stripeEnabled() });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/checkout', requireV2Auth, async (req, res) => {
  try {
    if (!stripeEnabled()) {
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
    if (planId === 'free') {
      return res.status(400).json({ error: 'Free plan does not require checkout' });
    }

    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.v2Auth.orgId]);
    if (!sub) return res.status(404).json({ error: 'No subscription' });
    if (sub.is_comp === 1) {
      return res.status(400).json({ error: 'Comp accounts cannot change plan via checkout' });
    }

    const stripe = getStripe();
    let customerId = sub.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.v2Auth.email,
        metadata: { org_id: req.v2Auth.orgId },
      });
      customerId = customer.id;
      await db.run(`UPDATE v2_org_subscriptions SET stripe_customer_id = ? WHERE org_id = ?`, [
        customerId,
        req.v2Auth.orgId,
      ]);
    }

    const base = frontendBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${base}/v2/app/settings?billing=success`,
      cancel_url: `${base}/v2/app/settings?billing=cancel`,
      metadata: { org_id: req.v2Auth.orgId, plan_id: planId },
      subscription_data: {
        metadata: { org_id: req.v2Auth.orgId, plan_id: planId },
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error('[v2/billing/checkout]', e);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

router.post('/portal', requireV2Auth, async (req, res) => {
  try {
    if (!stripeEnabled()) {
      return res.status(503).json({ error: 'Stripe billing is not enabled', code: 'stripe_disabled' });
    }
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.v2Auth.orgId]);
    if (!sub?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer on file' });
    }
    const stripe = getStripe();
    const base = frontendBaseUrl();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${base}/v2/app/settings`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[v2/billing/portal]', e);
    res.status(500).json({ error: 'Portal failed' });
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
      ledger = await writeOverageLedgerForCycle(req.v2Auth.orgId, cycle.id);
    }
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
      autoChargeEnabled: process.env.V2_AUTO_CHARGE_ENABLED === 'true',
      ledger,
    });
  } catch (e) {
    console.error('[v2/billing/settle-dry-run]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
