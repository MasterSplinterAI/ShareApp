/**
 * Usage pressure alerts: 80% included, 100% included (soft overage), ~90% hard cap.
 * Emails org owners/admins with per-org/alert-key daily dedupe.
 */
const db = require('../db/v2Database');
const {
  getOrgEntitlements,
  getMonthToDateUsage,
  hardCapMultiplier,
  assertCanCreateMeeting,
} = require('./v2Entitlements');
const { getOverageAutoChargeState } = require('./v2OrgBillingPrefs');
const { sendEmail } = require('./mailer');
const { renderUsageAlert } = require('./emailTemplates/usageAlert');

function meterState(used, included, hardCap) {
  const u = Number(used) || 0;
  const inc = Math.max(0, Number(included) || 0);
  const cap = Math.max(inc, Number(hardCap) || 0);
  const pctIncluded = inc > 0 ? Math.round((u / inc) * 100) : 0;
  const pctHard = cap > 0 ? Math.round((u / cap) * 100) : 0;
  let level = 'ok';
  if (cap > 0 && u >= cap) level = 'hard_stopped';
  else if (cap > 0 && pctHard >= 90) level = 'near_hard_cap';
  else if (inc > 0 && u >= inc) level = 'soft_overage';
  else if (inc > 0 && pctIncluded >= 80) level = 'running_low';
  else if (inc > 0 && pctIncluded >= 50) level = 'medium';
  return { used: u, included: inc, hardCap: cap, pctIncluded, pctHard, level };
}

async function getUsageAlertState(orgId) {
  const ent = await getOrgEntitlements(orgId);
  if (!ent) return null;
  if (ent.isComp) {
    return {
      unlimited: true,
      entitlements: ent,
      meeting: { used: 0, included: ent.includedMeetingMinutes, hardCap: null, pctIncluded: 0, pctHard: 0, level: 'ok' },
      translation: {
        used: 0,
        included: ent.includedTranslationMinutes,
        hardCap: null,
        pctIncluded: 0,
        pctHard: 0,
        level: 'ok',
      },
      worstLevel: 'ok',
      autoChargeEffective: false,
      multiplier: hardCapMultiplier(ent.planId),
    };
  }
  const usage = await getMonthToDateUsage(orgId);
  const mult = hardCapMultiplier(ent.planId);
  const meeting = meterState(
    usage.meetingMinutes,
    ent.includedMeetingMinutes,
    ent.includedMeetingMinutes * mult
  );
  const translation = meterState(
    usage.translationMinutes,
    ent.includedTranslationMinutes,
    ent.includedTranslationMinutes * mult
  );
  const rank = { ok: 0, medium: 1, running_low: 2, soft_overage: 3, near_hard_cap: 4, hard_stopped: 5 };
  const worstLevel =
    (rank[meeting.level] || 0) >= (rank[translation.level] || 0) ? meeting.level : translation.level;
  const autoCharge = await getOverageAutoChargeState(orgId);
  return {
    unlimited: false,
    entitlements: ent,
    usage,
    meeting,
    translation,
    worstLevel,
    autoChargeEffective: Boolean(autoCharge.effective),
    multiplier: mult,
  };
}

function alertKeysForState(state) {
  if (!state || state.unlimited) return [];
  const keys = [];
  for (const meter of ['meeting', 'translation']) {
    const m = state[meter];
    if (!m) continue;
    if (m.level === 'hard_stopped') keys.push(`${meter}:hard_stopped`);
    else if (m.level === 'near_hard_cap') keys.push(`${meter}:near_hard_cap`);
    else if (m.level === 'soft_overage') keys.push(`${meter}:soft_overage`);
    else if (m.level === 'running_low') keys.push(`${meter}:running_low`);
  }
  return keys;
}

async function alreadySentToday(orgId, alertKey) {
  const row = await db.get(
    `SELECT id FROM v2_usage_alert_events
     WHERE org_id = ? AND alert_key = ?
       AND datetime(sent_at) >= datetime('now', 'start of day')
     LIMIT 1`,
    [orgId, alertKey]
  );
  return Boolean(row);
}

async function markSent(orgId, alertKey) {
  await db.run(
    `INSERT INTO v2_usage_alert_events (id, org_id, alert_key, sent_at) VALUES (?, ?, ?, datetime('now'))`,
    [db.uuid(), orgId, alertKey]
  );
}

async function orgBillingEmails(orgId) {
  const rows = await db.all(
    `SELECT u.email, u.display_name
     FROM v2_org_members m
     JOIN v2_users u ON u.id = m.user_id
     WHERE m.org_id = ? AND m.role IN ('owner', 'admin') AND u.disabled_at IS NULL
     ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END`,
    [orgId]
  );
  return (rows || []).filter((r) => r.email);
}

/**
 * Evaluate usage and send deduped alert emails. Safe to call fire-and-forget.
 */
async function evaluateAndSendUsageAlerts(orgId) {
  if (!orgId) return { ok: false, reason: 'no_org' };
  const state = await getUsageAlertState(orgId);
  if (!state || state.unlimited) return { ok: true, skipped: 'unlimited_or_missing' };

  const keys = alertKeysForState(state);
  if (!keys.length) return { ok: true, skipped: 'no_alerts' };

  const recipients = await orgBillingEmails(orgId);
  if (!recipients.length) return { ok: true, skipped: 'no_recipients' };

  const org = await db.get(`SELECT name FROM v2_organizations WHERE id = ?`, [orgId]);
  const sent = [];

  for (const alertKey of keys) {
    if (await alreadySentToday(orgId, alertKey)) continue;
    const [meter, kind] = alertKey.split(':');
    const meterStateRow = state[meter];
    const email = renderUsageAlert({
      kind,
      meter,
      orgName: org?.name,
      planName: state.entitlements.planName,
      used: meterStateRow.used,
      included: meterStateRow.included,
      hardCap: meterStateRow.hardCap,
      multiplier: state.multiplier,
      autoChargeEffective: state.autoChargeEffective,
    });
    for (const r of recipients) {
      await sendEmail({
        to: r.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    }
    await markSent(orgId, alertKey);
    sent.push(alertKey);
  }

  return { ok: true, sent, worstLevel: state.worstLevel };
}

/** Compact payload for live meeting polling. */
async function getMeetingUsageStatusPayload(orgId) {
  const state = await getUsageAlertState(orgId);
  if (!state) return null;
  const gate = await assertCanCreateMeeting(orgId);
  return {
    unlimited: Boolean(state.unlimited),
    worstLevel: state.worstLevel,
    meeting: state.meeting,
    translation: state.translation,
    autoChargeEffective: state.autoChargeEffective,
    planId: state.entitlements?.planId,
    planName: state.entitlements?.planName,
    multiplier: state.multiplier,
    hardCapBlocked: Boolean(gate && !gate.ok),
    hardCapMessage: gate && !gate.ok ? gate.message : null,
  };
}

module.exports = {
  meterState,
  getUsageAlertState,
  alertKeysForState,
  evaluateAndSendUsageAlerts,
  getMeetingUsageStatusPayload,
};
