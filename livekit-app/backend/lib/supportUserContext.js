const db = require('../db/v2Database');
const { isSuperadminEmail } = require('./v2Superadmin');
const { getOrgEntitlements, getMonthToDateUsage } = require('./v2Entitlements');

function formatDateShort(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

async function buildUserContextSnapshot({ userId, orgId, email, guestEmail = null } = {}) {
  if (!userId && guestEmail) {
    return {
      accountKind: 'guest',
      email: guestEmail,
    };
  }
  if (!userId) return { accountKind: 'anonymous' };

  const user = await db.get(`SELECT id, email, display_name FROM v2_users WHERE id = ?`, [userId]);
  const membership = orgId
    ? await db.get(
        `SELECT m.role, o.name AS org_name, o.account_type, o.billing_status, o.suspended_at
         FROM v2_org_members m
         JOIN v2_organizations o ON o.id = m.org_id
         WHERE m.user_id = ? AND m.org_id = ?`,
        [userId, orgId]
      )
    : null;

  let entitlements = null;
  let usage = null;
  let subscription = null;
  if (orgId) {
    entitlements = await getOrgEntitlements(orgId);
    try {
      usage = await getMonthToDateUsage(orgId);
    } catch {
      usage = null;
    }
    try {
      subscription = await db.get(
        `SELECT plan_id, status, current_period_start, current_period_end,
                cancel_at_period_end, cancel_at, canceled_at, is_comp
         FROM v2_org_subscriptions WHERE org_id = ?`,
        [orgId]
      );
    } catch {
      subscription = null;
    }
  }

  const isPlatformAdmin = isSuperadminEmail(email || user?.email);
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);
  const accessEndsAt = subscription?.cancel_at || (cancelAtPeriodEnd ? subscription?.current_period_end : null);
  const isFullyCanceled = ['canceled', 'cancelled', 'unpaid', 'incomplete_expired'].includes(
    String(subscription?.status || '').toLowerCase()
  );
  const renewsAt =
    !isFullyCanceled && !cancelAtPeriodEnd && !subscription?.cancel_at
      ? subscription?.current_period_end
      : null;

  const includedMeeting = entitlements?.includedMeetingMinutes ?? null;
  const includedTranslation = entitlements?.includedTranslationMinutes ?? null;
  const usedMeeting = usage?.meetingMinutes ?? 0;
  const usedTranslation = usage?.translationMinutes ?? 0;

  return {
    accountKind: 'registered',
    userId,
    email: email || user?.email || null,
    displayName: user?.display_name || null,
    orgId: orgId || null,
    orgName: membership?.org_name || null,
    orgRole: membership?.role || null,
    workspaceType: membership?.account_type || 'personal',
    billingStatus: membership?.billing_status || null,
    orgSuspended: Boolean(membership?.suspended_at),
    isPlatformAdmin,
    plan: entitlements
      ? {
          id: entitlements.planId,
          name: entitlements.planName,
          status: entitlements.status,
          isComp: entitlements.isComp,
          teamWorkspace: entitlements.teamWorkspace,
          includedMeetingMinutes: includedMeeting,
          includedTranslationMinutes: includedTranslation,
          monthlyPriceCents: entitlements.monthlyPriceCents ?? null,
        }
      : null,
    usage: usage
      ? {
          meetingMinutesThisMonth: usedMeeting,
          translationMinutesThisMonth: usedTranslation,
          meetingMinutesRemaining:
            entitlements?.isComp || includedMeeting == null
              ? null
              : Math.max(0, Number(includedMeeting) - usedMeeting),
          translationMinutesRemaining:
            entitlements?.isComp || includedTranslation == null
              ? null
              : Math.max(0, Number(includedTranslation) - usedTranslation),
          window: 'calendar_month_mtd',
        }
      : null,
    billing: subscription
      ? {
          stripeStatus: subscription.status,
          cancelAtPeriodEnd,
          cancelAt: subscription.cancel_at || null,
          canceledAt: subscription.canceled_at || null,
          currentPeriodStart: subscription.current_period_start || null,
          currentPeriodEnd: subscription.current_period_end || null,
          accessEndsAt,
          renewsAt,
          isFullyCanceled,
        }
      : null,
  };
}

function formatUserContextForPrompt(snapshot) {
  if (!snapshot || snapshot.accountKind === 'anonymous') {
    return 'User context: anonymous or unknown (guest may have provided email only).';
  }
  if (snapshot.accountKind === 'guest') {
    return `User context: guest submitter (email: ${snapshot.email || 'unknown'}). No org/plan on file — avoid plan-specific claims.`;
  }

  const lines = ['User context (tailor answers to this — do not invent different plan or role):'];
  if (snapshot.displayName) lines.push(`- Name: ${snapshot.displayName}`);
  if (snapshot.email) lines.push(`- Email: ${snapshot.email}`);
  if (snapshot.orgName) lines.push(`- Workspace: ${snapshot.orgName}`);
  if (snapshot.workspaceType) lines.push(`- Workspace type: ${snapshot.workspaceType}`);
  if (snapshot.orgRole) lines.push(`- Org role: ${snapshot.orgRole}`);
  if (snapshot.isPlatformAdmin) {
    lines.push('- Platform administrator: yes (full platform Admin tools in sidebar; account settings still under Settings)');
  }
  if (snapshot.plan) {
    lines.push(
      `- Plan: ${snapshot.plan.name} (${snapshot.plan.id}), status ${snapshot.plan.status}` +
        (snapshot.plan.isComp ? ', complimentary/unlimited' : '')
    );
    if (snapshot.plan.monthlyPriceCents != null && snapshot.plan.monthlyPriceCents > 0) {
      lines.push(`- Plan price: $${(snapshot.plan.monthlyPriceCents / 100).toFixed(2)}/month`);
    }
    if (snapshot.plan.includedMeetingMinutes != null) {
      lines.push(`- Included meeting minutes/month: ${snapshot.plan.includedMeetingMinutes}`);
    }
    if (snapshot.plan.includedTranslationMinutes != null) {
      lines.push(`- Included translation minutes/month: ${snapshot.plan.includedTranslationMinutes}`);
    }
    if (!snapshot.plan.teamWorkspace) {
      lines.push('- Team workspace features: not on current plan');
    }
  }
  if (snapshot.usage) {
    lines.push(
      `- Usage this calendar month (MTD): ${snapshot.usage.meetingMinutesThisMonth} meeting min used, ${snapshot.usage.translationMinutesThisMonth} translation min used`
    );
    if (snapshot.plan?.isComp) {
      lines.push('- Minutes remaining: unlimited (complimentary account)');
    } else {
      if (snapshot.usage.meetingMinutesRemaining != null) {
        lines.push(`- Meeting minutes remaining this month: ${snapshot.usage.meetingMinutesRemaining}`);
      }
      if (snapshot.usage.translationMinutesRemaining != null) {
        lines.push(
          `- Translation minutes remaining this month: ${snapshot.usage.translationMinutesRemaining}`
        );
      }
    }
  }
  if (snapshot.billing) {
    const b = snapshot.billing;
    if (b.isFullyCanceled) {
      lines.push('- Subscription: canceled (no further charges). User can renew by upgrading again in Settings → Billing.');
    } else if (b.cancelAtPeriodEnd || b.cancelAt) {
      const endLabel = formatDateShort(b.accessEndsAt || b.currentPeriodEnd);
      lines.push(
        `- Subscription: cancellation scheduled` +
          (endLabel ? ` — access continues through ${endLabel}; no renewal charge after that` : '')
      );
      lines.push('- User can resume/renew before that date in Settings → Billing.');
    } else if (b.renewsAt) {
      const renewLabel = formatDateShort(b.renewsAt);
      lines.push(
        `- Next renewal / charge date: ${renewLabel || b.renewsAt} (end of current Stripe billing period)`
      );
    } else if (b.currentPeriodEnd) {
      lines.push(`- Current billing period ends: ${formatDateShort(b.currentPeriodEnd) || b.currentPeriodEnd}`);
    }
  }
  if (snapshot.billingStatus) lines.push(`- Org billing_status: ${snapshot.billingStatus}`);
  if (snapshot.orgSuspended) lines.push('- Workspace is suspended');
  return lines.join('\n');
}

module.exports = {
  buildUserContextSnapshot,
  formatUserContextForPrompt,
};
