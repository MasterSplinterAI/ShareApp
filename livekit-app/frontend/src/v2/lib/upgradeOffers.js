/** Self-serve checkout tiers (seed plans). */
const PLAN_RANK = { free: 0, starter: 1, pro: 2 };

const LEVEL_RANK = {
  ok: 0,
  medium: 1,
  high: 2,
  running_low: 2,
  over: 3,
  soft_overage: 3,
  near_hard_cap: 4,
  hard_stopped: 5,
};

export function canManageBilling(role) {
  return ['owner', 'admin'].includes(role);
}

export function formatPlanPrice(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return 'Free';
  return `$${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}/mo`;
}

function hardCapMultiplier(planId) {
  if (planId === 'free') return 1;
  return 2;
}

/** Per-meter pressure including hard-cap distance. */
export function getMeterPressure(usedRaw, includedRaw, planId) {
  const used = Math.round(Number(usedRaw) || 0);
  const included = Math.max(0, Number(includedRaw) || 0);
  const mult = hardCapMultiplier(planId);
  const hardCap = included * mult;
  if (!included) return { used, included: 0, hardCap: 0, percent: 0, pctHard: 0, level: 'ok' };
  const percent = Math.min(100, Math.round((used / included) * 100));
  const pctHard = hardCap > 0 ? Math.min(100, Math.round((used / hardCap) * 100)) : 0;
  let level = 'ok';
  if (used >= hardCap) level = 'hard_stopped';
  else if (pctHard >= 90) level = 'near_hard_cap';
  else if (used >= included) level = 'soft_overage';
  else if (percent >= 80) level = 'high';
  else if (percent >= 50) level = 'medium';
  return { used, included, hardCap, percent, pctHard, level, multiplier: mult };
}

/** Meeting-minute pressure (back-compat). */
export function getUsagePressure(usage, plan) {
  return getMeterPressure(
    usage?.meetingMinutes,
    plan?.included_meeting_minutes,
    plan?.id
  );
}

function worsePressure(a, b) {
  return (LEVEL_RANK[a.level] || 0) >= (LEVEL_RANK[b.level] || 0) ? a : b;
}

/** Next paid tier above the current plan, preferring starter then pro. */
export function nextUpgradePlans(currentPlanId, plans = []) {
  const rank = PLAN_RANK[currentPlanId] ?? 0;
  return (plans || [])
    .filter((p) => p.id !== 'free' && (PLAN_RANK[p.id] ?? 99) > rank)
    .sort((a, b) => (PLAN_RANK[a.id] ?? 99) - (PLAN_RANK[b.id] ?? 99));
}

export function getRecommendedUpgrade({ subscription, plans, usage, role }) {
  const plan = subscription?.plan;
  const sub = subscription?.subscription;
  if (!plan || sub?.is_comp === 1) return { show: false };

  const meeting = getMeterPressure(usage?.meetingMinutes, plan.included_meeting_minutes, plan.id);
  const translation = getMeterPressure(
    usage?.translationMinutes,
    plan.included_translation_minutes,
    plan.id
  );
  const pressure = worsePressure(meeting, translation);
  const pressureMeter =
    (LEVEL_RANK[translation.level] || 0) > (LEVEL_RANK[meeting.level] || 0) ? 'translation' : 'meeting';

  const upgrades = nextUpgradePlans(plan.id, plans);
  const stripeEnabled = Boolean(subscription?.stripeEnabled);
  const canCheckout = canManageBilling(role) && stripeEnabled && upgrades.length > 0;
  const primaryPlan = upgrades[0] || null;
  const warnLevel = LEVEL_RANK[pressure.level] || 0;
  const showWarning = warnLevel >= LEVEL_RANK.high;
  const showUpgrade = upgrades.length > 0;
  if (!showUpgrade && !showWarning) return { show: false };

  let headline = primaryPlan ? `Upgrade to ${primaryPlan.name}` : 'Usage notice';
  let detail = primaryPlan
    ? `${formatPlanPrice(primaryPlan.monthly_price_cents)} · ${Number(primaryPlan.included_meeting_minutes).toLocaleString()} participant-minutes/mo`
    : '';

  if (plan.id === 'free' && primaryPlan) {
    headline = 'Get more meeting time';
    detail = `Starter includes ${Number(primaryPlan.included_meeting_minutes).toLocaleString()} min/mo from ${formatPlanPrice(primaryPlan.monthly_price_cents)}.`;
  } else if (primaryPlan?.teamWorkspace) {
    detail = `Invite colleagues, shared workspace, and ${Number(primaryPlan.included_meeting_minutes).toLocaleString()} min/mo.`;
  }

  const meterLabel = pressureMeter === 'translation' ? 'translation minutes' : 'participant-minutes';
  if (pressure.level === 'hard_stopped') {
    headline = 'Hard usage limit reached';
    detail = `${pressure.used.toLocaleString()} of ${pressure.hardCap.toLocaleString()} ${meterLabel} used (hard stop). Upgrade or wait for next month.`;
  } else if (pressure.level === 'near_hard_cap') {
    headline = 'Approaching hard stop';
    detail = `${pressure.used.toLocaleString()} of ${pressure.hardCap.toLocaleString()} ${meterLabel} used (${pressure.pctHard}% of hard limit). Meetings may end soon.`;
  } else if (pressure.level === 'soft_overage') {
    headline = 'In soft overage';
    detail = `${pressure.used.toLocaleString()} of ${pressure.included.toLocaleString()} included ${meterLabel} used. Hard stop at ${pressure.hardCap.toLocaleString()} (${pressure.multiplier}×). Auto-charge does not raise this limit.`;
  } else if (pressure.level === 'high') {
    headline = 'Running low on minutes';
    detail = `${pressure.used.toLocaleString()} of ${pressure.included.toLocaleString()} included ${meterLabel} used this month.`;
  }

  return {
    show: true,
    primaryPlan,
    upgrades,
    pressure,
    meetingPressure: meeting,
    translationPressure: translation,
    pressureMeter,
    stripeEnabled,
    canCheckout,
    currentPlan: plan,
    headline,
    detail,
    warningOnly: !showUpgrade && showWarning,
  };
}
