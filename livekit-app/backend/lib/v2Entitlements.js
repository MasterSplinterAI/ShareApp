const db = require('../db/v2Database');
const { orgIsSuspended } = require('./v2OrgLifecycle');
const { planAllowsTeamWorkspace } = require('./v2PlanFeatures');

/**
 * Hard stop multiplier on included minutes before blocking new joins / ending live rooms.
 * Free plans: 1× (strict ceiling). Paid plans: default 2× included quota (override via V2_HARD_CAP_MULTIPLIER).
 */
function hardCapMultiplier(planId) {
  if (planId === 'free') return 1;
  const raw = Number(process.env.V2_HARD_CAP_MULTIPLIER || 2);
  return Number.isFinite(raw) && raw >= 1 ? raw : 2;
}

/**
 * Load org subscription + plan quotas for entitlement checks.
 */
async function getOrgEntitlements(orgId) {
  const sub = await db.get(
    `SELECT s.*, p.name AS plan_name, p.monthly_price_cents, p.included_meeting_minutes, p.included_translation_minutes,
            p.overage_meeting_cents_per_min, p.overage_translation_cents_per_min
     FROM v2_org_subscriptions s
     JOIN v2_plans p ON p.id = s.plan_id
     WHERE s.org_id = ?`,
    [orgId]
  );
  if (!sub) return null;
  const meetingMinutes =
    sub.custom_included_meeting_minutes != null
      ? sub.custom_included_meeting_minutes
      : sub.included_meeting_minutes;
  const translationMinutes =
    sub.custom_included_translation_minutes != null
      ? sub.custom_included_translation_minutes
      : sub.included_translation_minutes;
  return {
    planId: sub.plan_id,
    planName: sub.plan_name,
    monthlyPriceCents: sub.monthly_price_cents,
    teamWorkspace: planAllowsTeamWorkspace(sub.plan_id),
    status: sub.status,
    isComp: sub.is_comp === 1,
    compLabel: sub.comp_label || null,
    includedMeetingMinutes: meetingMinutes,
    includedTranslationMinutes: translationMinutes,
    overageMeetingCentsPerMin: sub.overage_meeting_cents_per_min,
    overageTranslationCentsPerMin: sub.overage_translation_cents_per_min,
  };
}

/**
 * Sum usage for current calendar month (simple cycle until billing_cycles wired for all orgs).
 */
async function getMonthToDateUsage(orgId) {
  const row = await db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0) AS meeting_minutes,
       COALESCE(SUM(CASE WHEN event_type = 'translation_minute' THEN quantity ELSE 0 END), 0) AS translation_minutes
     FROM v2_usage_events
     WHERE org_id = ? AND created_at >= datetime('now', 'start of month')`,
    [orgId]
  );
  return {
    meetingMinutes: row?.meeting_minutes || 0,
    translationMinutes: row?.translation_minutes || 0,
  };
}

function hardCapDenied(code, message, usage, cap, entitlements) {
  return { ok: false, code, message, usage, cap, entitlements };
}

/**
 * Returns { ok: true } or { ok: false, code, ... }.
 */
async function assertCanCreateMeeting(orgId) {
  const org = await db.get(`SELECT id, suspended_at, billing_status FROM v2_organizations WHERE id = ?`, [orgId]);
  if (!org) {
    return { ok: false, code: 'no_org', message: 'Organization not found' };
  }
  if (orgIsSuspended(org)) {
    return { ok: false, code: 'org_suspended', message: 'This workspace has been suspended' };
  }
  if (org.billing_status === 'suspended' || org.billing_status === 'canceled') {
    return { ok: false, code: 'billing_inactive', message: 'Billing is not active for this workspace' };
  }
  const ent = await getOrgEntitlements(orgId);
  if (!ent) {
    return { ok: false, code: 'no_subscription', message: 'Organization has no active plan' };
  }
  if (ent.isComp) {
    const usage = await getMonthToDateUsage(orgId);
    return { ok: true, entitlements: ent, usage, unlimited: true };
  }
  if (!['active', 'trialing'].includes(String(ent.status).toLowerCase())) {
    return { ok: false, code: 'billing_inactive', message: 'Subscription is not active' };
  }
  const usage = await getMonthToDateUsage(orgId);
  const mult = hardCapMultiplier(ent.planId);
  const meetingCap = ent.includedMeetingMinutes * mult;
  const translationCap = ent.includedTranslationMinutes * mult;

  if (usage.meetingMinutes >= meetingCap) {
    return hardCapDenied(
      'hard_cap_meeting',
      ent.planId === 'free'
        ? 'Free plan limit reached (60 participant-minutes/month). Upgrade to continue.'
        : 'Meeting usage exceeds the plan hard limit (2× included participant-minutes). Upgrade or contact support.',
      usage,
      meetingCap,
      ent
    );
  }

  if (usage.translationMinutes >= translationCap) {
    return hardCapDenied(
      'hard_cap_translation',
      ent.planId === 'free'
        ? 'Free plan translation limit reached. Upgrade to continue.'
        : 'Translation usage exceeds the plan hard limit (2× included translation minutes). Upgrade or contact support.',
      usage,
      translationCap,
      ent
    );
  }

  return {
    ok: true,
    entitlements: ent,
    usage,
    caps: { meeting: meetingCap, translation: translationCap },
    // Back-compat for callers that read gate.cap as meeting hard cap
    cap: meetingCap,
  };
}

/** Same usage-cap gate as meeting create — used for guest join and in-meeting enforcement. */
async function assertGuestJoinAllowed(orgId) {
  return assertCanCreateMeeting(orgId);
}

const HARD_CAP_CODES = new Set(['hard_cap_meeting', 'hard_cap_translation']);

function isHardCapDenied(gate) {
  return Boolean(gate && !gate.ok && HARD_CAP_CODES.has(gate.code));
}

module.exports = {
  getOrgEntitlements,
  getMonthToDateUsage,
  assertCanCreateMeeting,
  assertGuestJoinAllowed,
  hardCapMultiplier,
  isHardCapDenied,
  HARD_CAP_CODES,
};
