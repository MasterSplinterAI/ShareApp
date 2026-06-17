const db = require('../db/v2Database');
const { recordConsentEvent } = require('./communicationPrefs');
const { getStripeSettings } = require('./v2StripeSettings');

async function getOverageAutoChargeState(orgId) {
  const settings = await getStripeSettings();
  const sub = await db.get(
    `SELECT overage_auto_charge_opt_in, overage_auto_charge_opt_in_at, overage_auto_charge_opt_in_by
     FROM v2_org_subscriptions WHERE org_id = ?`,
    [orgId]
  );
  const orgOptIn = Boolean(sub?.overage_auto_charge_opt_in);
  return {
    platformEnabled: settings.autoChargeEnabled,
    orgOptIn,
    effective: settings.autoChargeEnabled && orgOptIn,
    optedInAt: sub?.overage_auto_charge_opt_in_at || null,
    optedInBy: sub?.overage_auto_charge_opt_in_by || null,
  };
}

async function setOverageAutoChargeOptIn(orgId, userId, optIn, req) {
  const settings = await getStripeSettings();
  if (!settings.autoChargeEnabled) {
    return { ok: false, error: 'Overage auto-charge is not available on this platform' };
  }

  const sub = await db.get(`SELECT org_id, is_comp FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
  if (!sub) return { ok: false, error: 'No subscription' };
  if (sub.is_comp === 1) {
    return { ok: false, error: 'Comp accounts are not billed for overages' };
  }

  const next = Boolean(optIn);
  const now = new Date().toISOString();
  await db.run(
    `UPDATE v2_org_subscriptions
     SET overage_auto_charge_opt_in = ?,
         overage_auto_charge_opt_in_at = ?,
         overage_auto_charge_opt_in_by = ?
     WHERE org_id = ?`,
    [next ? 1 : 0, next ? now : null, next ? userId : null, orgId]
  );

  await recordConsentEvent(userId, 'overage_auto_charge', next, req);

  return { ok: true, state: await getOverageAutoChargeState(orgId) };
}

module.exports = {
  getOverageAutoChargeState,
  setOverageAutoChargeOptIn,
};
