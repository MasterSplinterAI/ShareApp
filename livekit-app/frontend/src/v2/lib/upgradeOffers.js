/** Self-serve checkout tiers (seed plans). */
const PLAN_RANK = { free: 0, starter: 1, pro: 2 };

export function canManageBilling(role) {
  return ['owner', 'admin'].includes(role);
}

export function formatPlanPrice(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return 'Free';
  return `$${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}/mo`;
}

export function getUsagePressure(usage, plan) {
  const used = Math.round(Number(usage?.meetingMinutes) || 0);
  const included = Math.max(0, Number(plan?.included_meeting_minutes) || 0);
  if (!included) return { used, included: 0, percent: 0, level: 'ok' };
  const percent = Math.min(100, Math.round((used / included) * 100));
  let level = 'ok';
  if (percent >= 100) level = 'over';
  else if (percent >= 80) level = 'high';
  else if (percent >= 50) level = 'medium';
  return { used, included, percent, level };
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

  const upgrades = nextUpgradePlans(plan.id, plans);
  if (!upgrades.length) return { show: false };

  const primaryPlan = upgrades[0];
  const pressure = getUsagePressure(usage, plan);
  const stripeEnabled = Boolean(subscription?.stripeEnabled);
  const canCheckout = canManageBilling(role) && stripeEnabled;

  let headline = `Upgrade to ${primaryPlan.name}`;
  let detail = `${formatPlanPrice(primaryPlan.monthly_price_cents)} · ${Number(primaryPlan.included_meeting_minutes).toLocaleString()} participant-minutes/mo`;

  if (plan.id === 'free') {
    headline = 'Get more meeting time';
    detail = `Starter includes ${Number(primaryPlan.included_meeting_minutes).toLocaleString()} min/mo from ${formatPlanPrice(primaryPlan.monthly_price_cents)}.`;
  } else if (primaryPlan.teamWorkspace) {
    detail = `Invite colleagues, shared workspace, and ${Number(primaryPlan.included_meeting_minutes).toLocaleString()} min/mo.`;
  }

  if (pressure.level === 'over' || pressure.level === 'high') {
    headline = pressure.level === 'over' ? 'Usage limit reached' : 'Running low on minutes';
    detail = `${pressure.used.toLocaleString()} of ${pressure.included.toLocaleString()} included minutes used this month. Upgrade for more capacity.`;
  }

  return {
    show: true,
    primaryPlan,
    upgrades,
    pressure,
    stripeEnabled,
    canCheckout,
    currentPlan: plan,
    headline,
    detail,
  };
}
