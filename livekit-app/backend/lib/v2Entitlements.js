const db = require('../db/v2Database');
const { planAllowsTeamWorkspace } = require('./v2PlanFeatures');

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
  return {
    planId: sub.plan_id,
    planName: sub.plan_name,
    monthlyPriceCents: sub.monthly_price_cents,
    teamWorkspace: planAllowsTeamWorkspace(sub.plan_id),
    status: sub.status,
    isComp: sub.is_comp === 1,
    compLabel: sub.comp_label || null,
    includedMeetingMinutes: sub.included_meeting_minutes,
    includedTranslationMinutes: sub.included_translation_minutes,
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

/**
 * Returns { ok: true } or { ok: false, reason, ... }.
 */
async function assertCanCreateMeeting(orgId) {
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
  const cap = ent.includedMeetingMinutes * hardCapMultiplier(ent.planId);
  if (usage.meetingMinutes >= cap) {
    return {
      ok: false,
      code: 'hard_cap_meeting',
      message:
        ent.planId === 'free'
          ? 'Free plan limit reached (60 participant-minutes/month). Upgrade to continue.'
          : 'Meeting usage exceeds policy; contact support or upgrade',
      usage,
      cap,
      entitlements: ent,
    };
  }
  return { ok: true, entitlements: ent, usage, cap };
}

module.exports = {
  getOrgEntitlements,
  getMonthToDateUsage,
  assertCanCreateMeeting,
  hardCapMultiplier,
};
