const db = require('../db/v2Database');
const { getStripeSettings, getStripeClient, isStripeBillingActive } = require('./v2StripeSettings');

const SUSPEND_REASON_PREFIX = 'stripe_dispute:';

const OPEN_DISPUTE_STATUSES = new Set([
  'needs_response',
  'under_review',
  'warning_needs_response',
  'warning_under_review',
]);

const WON_DISPUTE_STATUSES = new Set(['won', 'warning_closed']);

function unixToIso(sec) {
  if (sec == null) return null;
  const n = Number(sec);
  if (!Number.isFinite(n)) return null;
  return new Date(Math.floor(n * 1000)).toISOString();
}

function customerIdFrom(obj) {
  if (!obj) return null;
  if (typeof obj.customer === 'string') return obj.customer;
  return obj.customer?.id || null;
}

async function resolveCustomerIdFromDispute(dispute) {
  const direct = customerIdFrom(dispute);
  if (direct) return direct;

  const settings = await getStripeSettings();
  if (!isStripeBillingActive(settings)) return null;
  const stripe = getStripeClient(settings);

  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      const cid = customerIdFrom(charge);
      if (cid) return cid;
    } catch (err) {
      console.warn('[stripe-dispute] charge retrieve failed:', chargeId, err.message);
    }
  }

  const piId =
    typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
  if (piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId);
      const cid = customerIdFrom(pi);
      if (cid) return cid;
    } catch (err) {
      console.warn('[stripe-dispute] payment_intent retrieve failed:', piId, err.message);
    }
  }

  return null;
}

async function findOrgIdByCustomer(customerId) {
  if (!customerId) return null;
  const row = await db.get(
    `SELECT org_id FROM v2_org_subscriptions WHERE stripe_customer_id = ? LIMIT 1`,
    [customerId]
  );
  return row?.org_id || null;
}

async function upsertDisputeRow({
  dispute,
  orgId,
  customerId,
  chargeId,
}) {
  const id = String(dispute.id);
  const status = String(dispute.status || 'unknown').slice(0, 64);
  const reason = String(dispute.reason || '').slice(0, 128);
  const amountCents = Math.round(Number(dispute.amount) || 0);
  const currency = String(dispute.currency || 'usd').slice(0, 8);
  const evidenceDueBy = unixToIso(dispute.evidence_details?.due_by);
  const closedAt = OPEN_DISPUTE_STATUSES.has(status) ? null : unixToIso(dispute.created) || new Date().toISOString();
  const existing = await db.get(`SELECT id FROM v2_stripe_disputes WHERE id = ?`, [id]);
  if (existing) {
    await db.run(
      `UPDATE v2_stripe_disputes SET
         org_id = COALESCE(?, org_id),
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         charge_id = COALESCE(?, charge_id),
         status = ?,
         reason = ?,
         amount_cents = ?,
         currency = ?,
         evidence_due_by = ?,
         closed_at = CASE WHEN ? IS NULL THEN closed_at ELSE COALESCE(closed_at, ?) END,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        orgId,
        customerId,
        chargeId,
        status,
        reason,
        amountCents,
        currency,
        evidenceDueBy,
        closedAt,
        closedAt,
        id,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO v2_stripe_disputes (
         id, org_id, stripe_customer_id, charge_id, status, reason,
         amount_cents, currency, evidence_due_by, created_at, updated_at, closed_at
       ) VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'), ?)`,
      [
        id,
        orgId,
        customerId,
        chargeId,
        status,
        reason,
        amountCents,
        currency,
        evidenceDueBy,
        OPEN_DISPUTE_STATUSES.has(status) ? null : new Date().toISOString(),
      ]
    );
  }
}

async function suspendOrgForDispute(orgId, disputeId, status) {
  const org = await db.get(`SELECT id, suspended_at, suspended_reason FROM v2_organizations WHERE id = ?`, [orgId]);
  if (!org) return { suspended: false, reason: 'org_missing' };

  const sub = await db.get(`SELECT is_comp FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
  if (sub?.is_comp === 1) return { suspended: false, reason: 'comp_account' };

  const suspendReason = `${SUSPEND_REASON_PREFIX}${disputeId}:${status}`.slice(0, 500);
  await db.run(
    `UPDATE v2_organizations
     SET suspended_at = COALESCE(suspended_at, datetime('now')),
         suspended_reason = ?,
         billing_status = 'suspended'
     WHERE id = ?`,
    [suspendReason, orgId]
  );
  return { suspended: true, reason: suspendReason };
}

async function maybeReactivateAfterWonDispute(orgId, disputeId) {
  const org = await db.get(`SELECT suspended_at, suspended_reason FROM v2_organizations WHERE id = ?`, [orgId]);
  if (!org?.suspended_at) return { reactivated: false, reason: 'not_suspended' };
  const reason = String(org.suspended_reason || '');
  if (!reason.startsWith(SUSPEND_REASON_PREFIX)) {
    return { reactivated: false, reason: 'other_suspend_reason' };
  }
  // Only auto-reinstate if this dispute (or any stripe dispute) caused the lock.
  if (!reason.includes(disputeId) && !reason.startsWith(SUSPEND_REASON_PREFIX)) {
    return { reactivated: false, reason: 'other_dispute' };
  }

  const openOther = await db.get(
    `SELECT id FROM v2_stripe_disputes
     WHERE org_id = ? AND id != ? AND status IN (${[...OPEN_DISPUTE_STATUSES].map(() => '?').join(',')})
     LIMIT 1`,
    [orgId, disputeId, ...OPEN_DISPUTE_STATUSES]
  );
  if (openOther) return { reactivated: false, reason: 'other_open_disputes' };

  await db.run(
    `UPDATE v2_organizations
     SET suspended_at = NULL, suspended_reason = NULL, billing_status = 'active'
     WHERE id = ?`,
    [orgId]
  );
  return { reactivated: true };
}

/**
 * Apply a Stripe charge.dispute.* event.
 */
async function applyStripeDisputeEvent(eventType, dispute) {
  if (!dispute?.id) return { ok: false, reason: 'missing_dispute' };

  const customerId = await resolveCustomerIdFromDispute(dispute);
  const orgId = await findOrgIdByCustomer(customerId);
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id || null;
  const status = String(dispute.status || 'unknown');

  await upsertDisputeRow({ dispute, orgId, customerId, chargeId });

  if (!orgId) {
    console.warn('[stripe-dispute] no org for customer', customerId, 'dispute', dispute.id);
    return { ok: true, orgId: null, customerId, status, action: 'recorded_unmapped' };
  }

  if (OPEN_DISPUTE_STATUSES.has(status) || eventType === 'charge.dispute.created') {
    const sus = await suspendOrgForDispute(orgId, dispute.id, status);
    return { ok: true, orgId, customerId, status, action: 'suspend', ...sus };
  }

  if (WON_DISPUTE_STATUSES.has(status)) {
    const rein = await maybeReactivateAfterWonDispute(orgId, dispute.id);
    return { ok: true, orgId, customerId, status, action: 'won_check', ...rein };
  }

  // lost / charge_refunded / funds_withdrawn — keep suspended, refresh reason
  if (['lost', 'charge_refunded'].includes(status)) {
    await suspendOrgForDispute(orgId, dispute.id, status);
    return { ok: true, orgId, customerId, status, action: 'keep_suspended' };
  }

  return { ok: true, orgId, customerId, status, action: 'recorded' };
}

module.exports = {
  applyStripeDisputeEvent,
  OPEN_DISPUTE_STATUSES,
  WON_DISPUTE_STATUSES,
  SUSPEND_REASON_PREFIX,
};
