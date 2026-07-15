/**
 * Ensure each org has a billing cycle covering "now".
 * Prefer Stripe subscription period bounds when linked; otherwise calendar month.
 */
const db = require('../db/v2Database');

function calendarMonthBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function resolveOrgPeriodBounds(orgId) {
  const sub = await db.get(
    `SELECT stripe_subscription_id, current_period_start, current_period_end
     FROM v2_org_subscriptions WHERE org_id = ?`,
    [orgId]
  );
  if (
    sub?.stripe_subscription_id &&
    sub.current_period_start &&
    sub.current_period_end &&
    new Date(sub.current_period_end).getTime() > Date.now()
  ) {
    return {
      start: String(sub.current_period_start),
      end: String(sub.current_period_end),
      source: 'stripe',
    };
  }
  const cal = calendarMonthBounds();
  return { ...cal, source: 'calendar' };
}

/**
 * Open (or return) the cycle matching the org's current Stripe/calendar period.
 * Previous cycles remain in the table with their period_end; settlement uses closed ones.
 */
async function ensureCurrentBillingCycle(orgId) {
  if (!orgId) throw new Error('orgId required');
  const bounds = await resolveOrgPeriodBounds(orgId);

  const exact = await db.get(
    `SELECT * FROM v2_billing_cycles WHERE org_id = ? AND period_start = ? AND period_end = ?`,
    [orgId, bounds.start, bounds.end]
  );
  if (exact) {
    return { cycle: exact, created: false, source: bounds.source };
  }

  const covering = await db.get(
    `SELECT * FROM v2_billing_cycles
     WHERE org_id = ?
       AND datetime(period_start) <= datetime('now')
       AND datetime(period_end) >= datetime('now')
     ORDER BY datetime(period_start) DESC
     LIMIT 1`,
    [orgId]
  );
  // Stripe period changed mid-flight: open the new exact window (don't mutate older rows).
  if (covering && covering.period_start === bounds.start && covering.period_end === bounds.end) {
    return { cycle: covering, created: false, source: bounds.source };
  }

  const id = db.uuid();
  await db.run(`INSERT INTO v2_billing_cycles (id, org_id, period_start, period_end) VALUES (?,?,?,?)`, [
    id,
    orgId,
    bounds.start,
    bounds.end,
  ]);
  return {
    cycle: { id, org_id: orgId, period_start: bounds.start, period_end: bounds.end, rolled_up_at: null },
    created: true,
    source: bounds.source,
  };
}

/** Best-effort rotate for every org that has a subscription row. */
async function ensureBillingCyclesForAllOrgs() {
  const orgs = await db.all(`SELECT org_id FROM v2_org_subscriptions`);
  let created = 0;
  for (const row of orgs) {
    try {
      const r = await ensureCurrentBillingCycle(row.org_id);
      if (r.created) created += 1;
    } catch (e) {
      console.warn('[v2BillingCycles] ensure failed', row.org_id, e.message);
    }
  }
  return { orgs: orgs.length, created };
}

module.exports = {
  calendarMonthBounds,
  resolveOrgPeriodBounds,
  ensureCurrentBillingCycle,
  ensureBillingCyclesForAllOrgs,
};
