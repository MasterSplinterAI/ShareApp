const db = require('../db/v2Database');

const BILLING_STATUSES = new Set(['trial', 'active', 'past_due', 'suspended', 'canceled']);

function isValidBillingStatus(status) {
  return BILLING_STATUSES.has(String(status || '').toLowerCase());
}

async function getUserLifecycle(userId) {
  return db.get(`SELECT id, email, disabled_at FROM v2_users WHERE id = ?`, [userId]);
}

async function getOrgLifecycle(orgId) {
  return db.get(
    `SELECT id, name, billing_status, suspended_at, suspended_reason FROM v2_organizations WHERE id = ?`,
    [orgId]
  );
}

function orgIsSuspended(org) {
  return Boolean(org?.suspended_at);
}

function userIsDisabled(user) {
  return Boolean(user?.disabled_at);
}

async function assertAccountActive(userId, orgId) {
  const user = await getUserLifecycle(userId);
  if (!user) return { ok: false, code: 'user_not_found', message: 'User not found' };
  if (userIsDisabled(user)) {
    return { ok: false, code: 'account_disabled', message: 'This account has been disabled' };
  }
  const org = await getOrgLifecycle(orgId);
  if (!org) return { ok: false, code: 'org_not_found', message: 'Organization not found' };
  if (orgIsSuspended(org)) {
    return { ok: false, code: 'org_suspended', message: 'This workspace has been suspended' };
  }
  if (org.billing_status === 'canceled') {
    return { ok: false, code: 'billing_canceled', message: 'Subscription canceled' };
  }
  return { ok: true, user, org };
}

module.exports = {
  BILLING_STATUSES,
  isValidBillingStatus,
  getUserLifecycle,
  getOrgLifecycle,
  orgIsSuspended,
  userIsDisabled,
  assertAccountActive,
};
