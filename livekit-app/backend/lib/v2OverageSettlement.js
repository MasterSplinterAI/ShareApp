const db = require('../db/v2Database');
const { writeOverageLedgerForCycle } = require('./v2OverageLedger');
const { getOverageAutoChargeState } = require('./v2OrgBillingPrefs');
const { getStripeSettings, getStripeClient, isStripeBillingActive } = require('./v2StripeSettings');

function metricLabel(metric) {
  if (metric === 'meeting_minutes_overage') return 'Meeting participant-minutes overage';
  if (metric === 'translation_minutes_overage') return 'Translation minutes overage';
  return metric;
}

/**
 * Charge pending overage ledger rows for a closed billing cycle (idempotent per ledger row).
 */
async function settlePendingOverageForOrgCycle(orgId, cycleId) {
  const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
  if (!sub) return { ok: false, skipped: 'no_subscription' };
  if (sub.is_comp === 1) return { ok: false, skipped: 'comp_account' };

  const autoCharge = await getOverageAutoChargeState(orgId);
  if (!autoCharge.effective) return { ok: false, skipped: 'auto_charge_off' };

  const cycle = await db.get(`SELECT * FROM v2_billing_cycles WHERE id = ? AND org_id = ?`, [cycleId, orgId]);
  if (!cycle) return { ok: false, skipped: 'cycle_not_found' };
  if (new Date(cycle.period_end).getTime() > Date.now()) {
    return { ok: false, skipped: 'cycle_not_closed' };
  }

  await writeOverageLedgerForCycle(orgId, cycleId);

  const pending = await db.all(
    `SELECT * FROM v2_overage_ledger WHERE org_id = ? AND cycle_id = ? AND status = 'pending'`,
    [orgId, cycleId]
  );
  if (!pending.length) return { ok: true, charged: [], skipped: 'nothing_pending' };

  if (!sub.stripe_customer_id) return { ok: false, skipped: 'no_stripe_customer' };

  const settings = await getStripeSettings();
  if (!isStripeBillingActive(settings)) return { ok: false, skipped: 'stripe_inactive' };
  const stripe = getStripeClient(settings);

  const charged = [];
  const failed = [];

  for (const row of pending) {
    const amountCents = Math.round(Number(row.amount_micros || 0) / 10000);
    if (amountCents <= 0) {
      await db.run(
        `UPDATE v2_overage_ledger SET status = 'charged', stripe_invoice_item_id = 'zero', settled_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
        [row.id]
      );
      charged.push({ metric: row.metric, amountCents: 0 });
      continue;
    }

    try {
      const item = await stripe.invoiceItems.create(
        {
          customer: sub.stripe_customer_id,
          amount: amountCents,
          currency: 'usd',
          description: `${metricLabel(row.metric)} — ${Number(row.units).toFixed(2)} units`,
        },
        { idempotencyKey: `parley-overage-${row.id}` }
      );

      const updated = await db.run(
        `UPDATE v2_overage_ledger SET status = 'charged', stripe_invoice_item_id = ?, settled_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
        [item.id, row.id]
      );
      if (updated.changes) {
        charged.push({ metric: row.metric, amountCents, invoiceItemId: item.id });
      }
    } catch (err) {
      await db.run(
        `UPDATE v2_overage_ledger SET status = 'failed', failure_reason = ?, settled_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
        [String(err.message || err).slice(0, 500), row.id]
      );
      failed.push({ metric: row.metric, error: err.message });
    }
  }

  if (charged.some((c) => c.amountCents > 0)) {
    try {
      const invoice = await stripe.invoices.create({
        customer: sub.stripe_customer_id,
        auto_advance: true,
        collection_method: 'charge_automatically',
      });
      await stripe.invoices.finalizeInvoice(invoice.id);
    } catch (err) {
      console.error('[overage-settlement] invoice finalize failed:', orgId, cycleId, err.message);
      return { ok: false, charged, failed, invoiceError: err.message };
    }
  }

  return { ok: true, charged, failed };
}

/**
 * Settle all orgs with billing cycles whose period_end has passed.
 */
async function settleDueOverageCycles({ orgId = null } = {}) {
  const params = [];
  let orgFilter = '';
  if (orgId) {
    orgFilter = ' AND c.org_id = ?';
    params.push(orgId);
  }

  const cycles = await db.all(
    `SELECT c.id AS cycle_id, c.org_id
     FROM v2_billing_cycles c
     WHERE datetime(c.period_end) <= datetime('now')${orgFilter}
     ORDER BY datetime(c.period_end) ASC`,
    params
  );

  const results = [];
  for (const row of cycles) {
    const result = await settlePendingOverageForOrgCycle(row.org_id, row.cycle_id);
    results.push({ orgId: row.org_id, cycleId: row.cycle_id, ...result });
  }

  return { processed: results.length, results };
}

module.exports = {
  settlePendingOverageForOrgCycle,
  settleDueOverageCycles,
};
