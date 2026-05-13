const db = require('../db/v2Database');

/**
 * Persists one row per overage metric for a closed billing cycle (idempotent per org/cycle/metric).
 */
async function writeOverageLedgerForCycle(orgId, cycleId) {
  const cycle = await db.get(`SELECT * FROM v2_billing_cycles WHERE id = ? AND org_id = ?`, [cycleId, orgId]);
  if (!cycle) return { ok: false, error: 'cycle_not_found' };
  const plan = await db.get(
    `SELECT p.* FROM v2_plans p JOIN v2_org_subscriptions s ON s.plan_id = p.id WHERE s.org_id = ?`,
    [orgId]
  );
  if (!plan) return { ok: false, error: 'no_plan' };
  const usage = await db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0) AS m,
       COALESCE(SUM(CASE WHEN event_type = 'translation_minute' THEN quantity ELSE 0 END), 0) AS t
     FROM v2_usage_events
     WHERE org_id = ? AND created_at >= ? AND created_at <= ?`,
    [orgId, cycle.period_start, cycle.period_end]
  );
  const overM = Math.max(0, (usage?.m || 0) - (plan.included_meeting_minutes || 0));
  const overT = Math.max(0, (usage?.t || 0) - (plan.included_translation_minutes || 0));
  const rateM = Math.round(plan.overage_meeting_cents_per_min || 0);
  const rateT = Math.round(plan.overage_translation_cents_per_min || 0);
  const amountMeetingCents = Math.round(overM * rateM);
  const amountTransCents = Math.round(overT * rateT);

  const written = [];

  if (overM > 0) {
    const dup = await db.get(
      `SELECT id FROM v2_overage_ledger WHERE org_id = ? AND cycle_id = ? AND metric = ?`,
      [orgId, cycleId, 'meeting_minutes_overage']
    );
    if (!dup) {
      await db.run(
        `INSERT INTO v2_overage_ledger (id, org_id, cycle_id, metric, units, rate_micros, amount_micros, status, created_at)
         VALUES (?,?,?,?,?,?,?,?, datetime('now'))`,
        [db.uuid(), orgId, cycleId, 'meeting_minutes_overage', overM, rateM * 10000, amountMeetingCents * 10000, 'pending']
      );
      written.push('meeting_minutes_overage');
    }
  }

  if (overT > 0) {
    const dup = await db.get(
      `SELECT id FROM v2_overage_ledger WHERE org_id = ? AND cycle_id = ? AND metric = ?`,
      [orgId, cycleId, 'translation_minutes_overage']
    );
    if (!dup) {
      await db.run(
        `INSERT INTO v2_overage_ledger (id, org_id, cycle_id, metric, units, rate_micros, amount_micros, status, created_at)
         VALUES (?,?,?,?,?,?,?,?, datetime('now'))`,
        [db.uuid(), orgId, cycleId, 'translation_minutes_overage', overT, rateT * 10000, amountTransCents * 10000, 'pending']
      );
      written.push('translation_minutes_overage');
    }
  }

  return { ok: true, written, overage: { meetingMinutes: overM, translationMinutes: overT } };
}

module.exports = { writeOverageLedgerForCycle };
