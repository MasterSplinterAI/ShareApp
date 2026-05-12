const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');

router.get('/plans', async (req, res) => {
  try {
    const plans = await db.all(`SELECT * FROM v2_plans ORDER BY monthly_price_cents ASC`);
    res.json({ plans });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/subscription', requireV2Auth, async (req, res) => {
  try {
    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.v2Auth.orgId]);
    const plan = sub ? await db.get(`SELECT * FROM v2_plans WHERE id = ?`, [sub.plan_id]) : null;
    res.json({ subscription: sub, plan });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Stripe (or other) webhook stub — verify signature in production.
 */
router.post('/webhook', async (req, res) => {
  console.log('[v2/billing/webhook] received', req.headers['stripe-signature'] ? '(stripe-signature present)' : '(no signature)');
  res.json({ received: true, mode: 'stub' });
});

/**
 * Dry-run overage settlement (auto-charge-ready stub).
 */
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
    });
  } catch (e) {
    console.error('[v2/billing/settle-dry-run]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
