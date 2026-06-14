const db = require('../db/v2Database');
const { isSuperadminEmail } = require('./v2Superadmin');
const { getOrgEntitlements, getMonthToDateUsage } = require('./v2Entitlements');

async function buildUserContextSnapshot({ userId, orgId, email, guestEmail = null } = {}) {
  if (!userId && guestEmail) {
    return {
      accountKind: 'guest',
      email: guestEmail,
    };
  }
  if (!userId) return { accountKind: 'anonymous' };

  const user = await db.get(`SELECT id, email, name FROM v2_users WHERE id = ?`, [userId]);
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
  if (orgId) {
    entitlements = await getOrgEntitlements(orgId);
    try {
      usage = await getMonthToDateUsage(orgId);
    } catch {
      usage = null;
    }
  }

  const isPlatformAdmin = isSuperadminEmail(email || user?.email);

  return {
    accountKind: 'registered',
    userId,
    email: email || user?.email || null,
    displayName: user?.name || null,
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
          includedMeetingMinutes: entitlements.includedMeetingMinutes,
          includedTranslationMinutes: entitlements.includedTranslationMinutes,
        }
      : null,
    usage: usage
      ? {
          meetingMinutesThisMonth: usage.meetingMinutes,
          translationMinutesThisMonth: usage.translationMinutes,
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
      `- Usage this month: ${snapshot.usage.meetingMinutesThisMonth} meeting min, ${snapshot.usage.translationMinutesThisMonth} translation min`
    );
  }
  if (snapshot.billingStatus) lines.push(`- Billing status: ${snapshot.billingStatus}`);
  if (snapshot.orgSuspended) lines.push('- Workspace is suspended');
  return lines.join('\n');
}

module.exports = {
  buildUserContextSnapshot,
  formatUserContextForPrompt,
};
