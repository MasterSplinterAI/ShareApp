const db = require('../db/v2Database');
const { writeOverageLedgerForCycle } = require('./v2OverageLedger');
const { getOverageAutoChargeState } = require('./v2OrgBillingPrefs');
const { getStripeSettings, getStripeClient, isStripeBillingActive } = require('./v2StripeSettings');
const { ensureBillingCyclesForAllOrgs } = require('./v2BillingCycles');

let lastSettlementRun = null;

function metricLabel(metric) {
  if (metric === 'meeting_minutes_overage') return 'Meeting participant-minutes overage';
  if (metric === 'translation_minutes_overage') return 'Translation minutes overage';
  return metric;
}

function getLastSettlementRun() {
  return lastSettlementRun;
}

/**
 * Charge pending overage ledger rows for a closed billing cycle (idempotent).
 * Creates a draft invoice, attaches items, finalizes — only then leaves pending_payment/charged.
 * Never marks charged before finalize succeeds.
 */
async function settlePendingOverageForOrgCycle(orgId, cycleId) {
  const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
  if (!sub) return { ok: false, skipped: 'no_subscription' };
  if (sub.is_comp === 1) return { ok: false, skipped: 'comp_account' };

  const autoCharge = await getOverageAutoChargeState(orgId);
  if (!autoCharge.effective) {
    // Still write ledger for visibility, but do not charge.
    await writeOverageLedgerForCycle(orgId, cycleId);
    return { ok: false, skipped: 'auto_charge_off' };
  }

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

  const billable = pending.filter((row) => Math.round(Number(row.amount_micros || 0) / 10000) > 0);
  const zeroRows = pending.filter((row) => Math.round(Number(row.amount_micros || 0) / 10000) <= 0);

  for (const row of zeroRows) {
    await db.run(
      `UPDATE v2_overage_ledger SET status = 'charged', stripe_invoice_item_id = 'zero', settled_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
      [row.id]
    );
  }

  if (!billable.length) {
    return { ok: true, charged: zeroRows.map((r) => ({ metric: r.metric, amountCents: 0 })), skipped: 'nothing_billable' };
  }

  let invoice;
  try {
    invoice = await stripe.invoices.create(
      {
        customer: sub.stripe_customer_id,
        auto_advance: false,
        collection_method: 'charge_automatically',
        metadata: { org_id: orgId, cycle_id: cycleId, purpose: 'overage_settlement' },
      },
      { idempotencyKey: `parley-overage-inv-${orgId}-${cycleId}` }
    );
  } catch (err) {
    console.error('[overage-settlement] invoice create failed:', orgId, cycleId, err.message);
    for (const row of billable) {
      await db.run(
        `UPDATE v2_overage_ledger SET status = 'failed', failure_reason = ?, settled_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
        [String(err.message || err).slice(0, 500), row.id]
      );
    }
    return { ok: false, failed: billable.map((r) => ({ metric: r.metric, error: err.message })), invoiceError: err.message };
  }

  const itemRefs = [];
  const failed = [];
  for (const row of billable) {
    const amountCents = Math.round(Number(row.amount_micros || 0) / 10000);
    try {
      const item = await stripe.invoiceItems.create(
        {
          customer: sub.stripe_customer_id,
          invoice: invoice.id,
          amount: amountCents,
          currency: 'usd',
          description: `${metricLabel(row.metric)} — ${Number(row.units).toFixed(2)} units`,
          metadata: { ledger_id: row.id, org_id: orgId, cycle_id: cycleId },
        },
        { idempotencyKey: `parley-overage-${row.id}` }
      );
      await db.run(
        `UPDATE v2_overage_ledger SET stripe_invoice_item_id = ?, stripe_invoice_id = ?
         WHERE id = ? AND status = 'pending'`,
        [item.id, invoice.id, row.id]
      );
      itemRefs.push({ row, itemId: item.id, amountCents });
    } catch (err) {
      await db.run(
        `UPDATE v2_overage_ledger SET status = 'failed', failure_reason = ?, settled_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
        [String(err.message || err).slice(0, 500), row.id]
      );
      failed.push({ metric: row.metric, error: err.message });
    }
  }

  if (!itemRefs.length) {
    return { ok: false, charged: [], failed, invoiceError: 'no_items_attached' };
  }

  let finalized;
  try {
    finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  } catch (err) {
    console.error('[overage-settlement] invoice finalize failed:', orgId, cycleId, err.message);
    for (const ref of itemRefs) {
      await db.run(
        `UPDATE v2_overage_ledger SET status = 'failed', failure_reason = ?, settled_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
        [String(err.message || err).slice(0, 500), ref.row.id]
      );
    }
    return {
      ok: false,
      charged: [],
      failed: [...failed, ...itemRefs.map((r) => ({ metric: r.row.metric, error: err.message }))],
      invoiceError: err.message,
    };
  }

  const paid = String(finalized.status || '') === 'paid';
  const nextStatus = paid ? 'charged' : 'pending_payment';
  const charged = [];
  for (const ref of itemRefs) {
    await db.run(
      `UPDATE v2_overage_ledger
       SET status = ?, stripe_invoice_id = ?, settled_at = CASE WHEN ? = 'charged' THEN datetime('now') ELSE settled_at END
       WHERE id = ? AND status = 'pending'`,
      [nextStatus, finalized.id, nextStatus, ref.row.id]
    );
    charged.push({
      metric: ref.row.metric,
      amountCents: ref.amountCents,
      invoiceItemId: ref.itemId,
      invoiceId: finalized.id,
      status: nextStatus,
    });
  }

  return { ok: true, charged, failed, invoiceId: finalized.id, invoiceStatus: finalized.status };
}

/**
 * Settle all orgs with billing cycles whose period_end has passed.
 */
async function settleDueOverageCycles({ orgId = null } = {}) {
  const startedAt = new Date().toISOString();
  try {
    await ensureBillingCyclesForAllOrgs();
  } catch (e) {
    console.warn('[overage-settlement] cycle rotation:', e.message);
  }

  const params = [];
  let orgFilter = '';
  if (orgId) {
    orgFilter = ' AND c.org_id = ?';
    params.push(orgId);
  }

  const closedCycles = await db.all(
    `SELECT c.id AS cycle_id, c.org_id
     FROM v2_billing_cycles c
     WHERE datetime(c.period_end) <= datetime('now')${orgFilter}
     ORDER BY datetime(c.period_end) ASC`,
    params
  );

  const results = [];
  for (const row of closedCycles) {
    const result = await settlePendingOverageForOrgCycle(row.org_id, row.cycle_id);
    results.push({ orgId: row.org_id, cycleId: row.cycle_id, ...result });
  }

  lastSettlementRun = {
    startedAt,
    finishedAt: new Date().toISOString(),
    processed: results.length,
    chargedCount: results.reduce((n, r) => n + (r.charged?.length || 0), 0),
    failedCount: results.reduce((n, r) => n + (r.failed?.length || 0), 0),
  };

  return { processed: results.length, results, lastSettlementRun };
}

async function markOverageLedgerForInvoice(invoice, status) {
  const invoiceId = invoice?.id;
  if (!invoiceId) return { updated: 0 };
  const settled = status === 'charged' ? `, settled_at = datetime('now')` : '';
  const result = await db.run(
    `UPDATE v2_overage_ledger
     SET status = ?, failure_reason = CASE WHEN ? = 'failed' THEN COALESCE(failure_reason, 'invoice_payment_failed') ELSE failure_reason END
         ${settled}
     WHERE stripe_invoice_id = ? AND status IN ('pending_payment', 'pending', 'failed')`,
    [status, status, invoiceId]
  );
  return { updated: result?.changes || 0, invoiceId, status };
}

module.exports = {
  settlePendingOverageForOrgCycle,
  settleDueOverageCycles,
  getLastSettlementRun,
  markOverageLedgerForInvoice,
};
