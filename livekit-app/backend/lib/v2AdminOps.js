const axios = require('axios');
const db = require('../db/v2Database');
const { writeAdminAudit } = require('./v2Superadmin');
const { hardCapMultiplier } = require('./v2Entitlements');
const { getAgentAlertSettings } = require('./agentFailover');
const { sendEmail } = require('./mailer');
const { SUPPORT_EMAIL } = require('./supportEmail');
const {
  getStripeSettings,
  isStripeBillingActive,
  getStripeClient,
} = require('./v2StripeSettings');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function adminAccountUrl(orgId) {
  const base = (
    process.env.PUBLIC_FRONTEND_BASE_URL ||
    process.env.FRONTEND_URL ||
    'https://lalia.cloud'
  )
    .trim()
    .replace(/\/$/, '');
  return orgId
    ? `${base}/v2/app/admin/orgs?org=${encodeURIComponent(orgId)}`
    : `${base}/v2/app/admin/overview`;
}

function parseAdminTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return normalizeAdminTags(raw);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeAdminTags(parsed) : [];
  } catch {
    return [];
  }
}

function normalizeAdminTags(rawList) {
  const arr = Array.isArray(rawList)
    ? rawList
    : typeof rawList === 'string'
      ? rawList.split(/[,;]+/)
      : [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const clean = String(item || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 12) break;
  }
  return out;
}

async function sendTelegramMessage(text, { botToken, chatId }) {
  if (!botToken || !chatId) return { sent: false, skipped: true };
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: String(text).slice(0, 4096),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: 10000 }
    );
    return { sent: true, messageId: res.data?.result?.message_id };
  } catch (err) {
    console.warn('[v2AdminOps] Telegram alert failed:', err.response?.data || err.message);
    return { sent: false, error: err.message };
  }
}

function describeUsageLevel(kind) {
  switch (kind) {
    case 'hard_stopped':
      return 'Hard cap reached (meetings blocked)';
    case 'near_hard_cap':
      return 'Near hard cap (90%+ of hard ceiling)';
    case 'soft_overage':
      return 'Entered overage (100%+ of included quota)';
    case 'running_low':
      return 'Approaching quota (80%+ of included minutes)';
    default:
      return kind;
  }
}

async function recordAndNotifyAdminUsageAlert({
  orgId,
  orgName = 'Workspace',
  planId = 'free',
  planName = 'Free',
  meter = 'meeting',
  kind = 'running_low',
  meterStateRow = {},
  autoChargeEffective = false,
  sendEmailFn = sendEmail,
  sendTelegramFn = sendTelegramMessage,
} = {}) {
  if (!orgId || !meter || !kind) return { ok: false, skipped: 'invalid_args' };

  const alertKey = `${meter}:${kind}`;
  const now = new Date();
  const nowIso = now.toISOString();
  const dayStartIso = `${nowIso.slice(0, 10)}T00:00:00.000Z`;

  const existingToday = await db.get(
    `SELECT id FROM v2_admin_usage_alerts
     WHERE org_id = ? AND alert_key = ? AND created_at >= ?
     LIMIT 1`,
    [orgId, alertKey, dayStartIso]
  );
  if (existingToday) {
    return { ok: true, deduped: true, id: existingToday.id };
  }

  const severity = ['hard_stopped', 'near_hard_cap'].includes(kind) ? 'critical' : 'warning';
  const used = Math.round(Number(meterStateRow.used || 0));
  const included = Math.round(Number(meterStateRow.included || 0));
  const pct = Number(meterStateRow.pctIncluded || 0);
  const meterLabel = meter === 'translation' ? 'translation minutes' : 'participant-minutes';
  const summary = `${orgName} (${planName}) — ${describeUsageLevel(kind)}: ${used.toLocaleString()}/${included.toLocaleString()} ${meterLabel} (${pct}%)`;

  const id = db.uuid();
  const details = {
    orgName,
    planId,
    planName,
    meter,
    kind,
    used,
    included,
    hardCap: meterStateRow.hardCap ?? null,
    pctIncluded: pct,
    autoChargeEffective: Boolean(autoChargeEffective),
  };

  // Notify outbound via Email / Telegram for overage/cap events, or 80%+ on paid plans
  const shouldNotifyOutbound =
    ['hard_stopped', 'near_hard_cap', 'soft_overage'].includes(kind) ||
    (kind === 'running_low' && planId !== 'free');

  let notifiedAt = null;
  if (shouldNotifyOutbound) {
    const settings = await getAgentAlertSettings();
    const link = adminAccountUrl(orgId);
    const subject = `[Lalia Usage ${severity === 'critical' ? 'CRITICAL' : 'Alert'}] ${orgName} — ${describeUsageLevel(kind)}`;
    const text = [
      `Account: ${orgName} (${orgId})`,
      `Plan: ${planName} (${planId})${autoChargeEffective ? ' · Overage auto-charge ON' : ''}`,
      `Status: ${describeUsageLevel(kind)}`,
      `Usage: ${used.toLocaleString()} / ${included.toLocaleString()} ${meterLabel} (${pct}%)`,
      `Review or grant bonus credits: ${link}`,
    ].join('\n');
    const html = [
      `<p><strong>${escapeHtml(describeUsageLevel(kind))}</strong></p>`,
      `<ul>`,
      `<li><strong>Account:</strong> ${escapeHtml(orgName)} (<code>${escapeHtml(orgId)}</code>)</li>`,
      `<li><strong>Plan:</strong> ${escapeHtml(planName)}${autoChargeEffective ? ' · Overage auto-charge ON' : ''}</li>`,
      `<li><strong>Usage:</strong> ${used.toLocaleString()} / ${included.toLocaleString()} ${escapeHtml(meterLabel)} (${pct}%)</li>`,
      `</ul>`,
      `<p><a href="${escapeHtml(link)}">Open Account in Admin &amp; Grant Credits →</a></p>`,
    ].join('');

    if (settings.emailEnabled && settings.effectiveEmails?.length) {
      for (const recipient of settings.effectiveEmails) {
        await sendEmailFn({
          to: recipient,
          replyTo: SUPPORT_EMAIL,
          subject,
          text,
          html,
        }).catch(() => {});
      }
      notifiedAt = nowIso;
    }

    if (
      settings.telegramEnabled &&
      settings.effectiveTelegramBotToken &&
      settings.effectiveTelegramChatId
    ) {
      const tg = [
        `${severity === 'critical' ? '🚨' : '📈'} <b>Lalia High-Usage Alert</b>`,
        `<b>${escapeHtml(orgName)}</b> (${escapeHtml(planName)})`,
        `${escapeHtml(describeUsageLevel(kind))}: <b>${used.toLocaleString()}/${included.toLocaleString()}</b> ${escapeHtml(meterLabel)} (${pct}%)`,
        `<a href="${escapeHtml(link)}">Inspect &amp; Grant Credit</a>`,
      ].join('\n');
      const tgRes = await sendTelegramFn(tg, {
        botToken: settings.effectiveTelegramBotToken,
        chatId: settings.effectiveTelegramChatId,
      });
      if (tgRes?.sent) notifiedAt = nowIso;
    }
  }

  await db.run(
    `INSERT INTO v2_admin_usage_alerts
     (id, org_id, alert_key, severity, summary, details_json, acknowledged_at, acknowledged_by, notified_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, alertKey, severity, summary, JSON.stringify(details), null, null, notifiedAt, nowIso]
  );

  return { ok: true, id, severity, notified: Boolean(notifiedAt) };
}

async function listUnacknowledgedAdminUsageAlerts(limit = 25) {
  const rows = await db.all(
    `SELECT a.*, o.name AS org_name, o.account_type, s.plan_id, s.is_comp,
            (SELECT u.email FROM v2_org_members m JOIN v2_users u ON u.id = m.user_id
             WHERE m.org_id = a.org_id
             ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, lower(u.email) LIMIT 1) AS owner_email
     FROM v2_admin_usage_alerts a
     LEFT JOIN v2_organizations o ON o.id = a.org_id
     LEFT JOIN v2_org_subscriptions s ON s.org_id = a.org_id
     WHERE a.acknowledged_at IS NULL
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [Math.max(1, Math.min(100, Number(limit) || 25))]
  );
  return (rows || []).map((r) => {
    let details = null;
    try {
      details = r.details_json ? JSON.parse(r.details_json) : null;
    } catch {
      details = null;
    }
    return { ...r, details };
  });
}

async function acknowledgeAdminUsageAlerts(actorEmail, ids = null) {
  const nowIso = new Date().toISOString();
  let res;
  if (Array.isArray(ids) && ids.length > 0) {
    const cleanIds = ids.map((x) => String(x)).slice(0, 100);
    const placeholders = cleanIds.map(() => '?').join(',');
    res = await db.run(
      `UPDATE v2_admin_usage_alerts
       SET acknowledged_at = ?, acknowledged_by = ?
       WHERE acknowledged_at IS NULL AND id IN (${placeholders})`,
      [nowIso, actorEmail || 'admin', ...cleanIds]
    );
  } else {
    res = await db.run(
      `UPDATE v2_admin_usage_alerts
       SET acknowledged_at = ?, acknowledged_by = ?
       WHERE acknowledged_at IS NULL`,
      [nowIso, actorEmail || 'admin']
    );
  }
  return { acknowledgedCount: res?.changes || 0 };
}

async function listOrgCreditGrants(orgId) {
  const nowIso = new Date().toISOString();
  const rows = await db.all(
    `SELECT * FROM v2_org_credit_grants WHERE org_id = ? ORDER BY created_at DESC LIMIT 100`,
    [orgId]
  );
  return (rows || []).map((r) => ({
    ...r,
    is_active:
      !r.revoked_at &&
      (!r.expires_at || String(r.expires_at) > nowIso),
  }));
}

async function grantBonusMinutes({
  orgId,
  meetingMinutes = 0,
  translationMinutes = 0,
  expiresInDays = 30,
  expiresAt = null,
  reason,
  actorEmail,
} = {}) {
  const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
  if (reasonTrim.length < 4) {
    return { ok: false, status: 400, error: 'reason required (4+ chars)' };
  }
  const meetMin = Math.max(0, Math.round(Number(meetingMinutes) || 0));
  const transMin = Math.max(0, Math.round(Number(translationMinutes) || 0));
  if (meetMin <= 0 && transMin <= 0) {
    return { ok: false, status: 400, error: 'Provide positive meetingMinutes or translationMinutes' };
  }
  if (meetMin > 1_000_000 || transMin > 1_000_000) {
    return { ok: false, status: 400, error: 'Bonus minutes exceed maximum single grant (1,000,000)' };
  }

  const org = await db.get(`SELECT id, name FROM v2_organizations WHERE id = ?`, [orgId]);
  if (!org) return { ok: false, status: 404, error: 'Organization not found' };

  let resolvedExpiresAt = null;
  if (expiresAt === 'never' || expiresInDays === 0 || expiresInDays === 'never') {
    resolvedExpiresAt = null;
  } else if (expiresAt === 'end_of_month') {
    const now = new Date();
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0) - 1);
    resolvedExpiresAt = endOfMonth.toISOString();
  } else if (typeof expiresAt === 'string' && expiresAt.trim()) {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, status: 400, error: 'Invalid expiresAt date' };
    }
    resolvedExpiresAt = d.toISOString();
  } else {
    const days = Math.max(1, Math.min(3650, Math.round(Number(expiresInDays) || 30)));
    resolvedExpiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  }

  const id = db.uuid();
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO v2_org_credit_grants
     (id, org_id, grant_type, bonus_meeting_minutes, bonus_translation_minutes, amount_cents, stripe_txn_id, expires_at, reason, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      orgId,
      'bonus_minutes',
      meetMin,
      transMin,
      0,
      null,
      resolvedExpiresAt,
      reasonTrim.slice(0, 2000),
      actorEmail || 'admin',
      createdAt,
    ]
  );

  await writeAdminAudit(db, actorEmail, 'admin_grant_bonus_minutes', {
    orgId,
    grantId: id,
    bonusMeetingMinutes: meetMin,
    bonusTranslationMinutes: transMin,
    expiresAt: resolvedExpiresAt,
    reason: reasonTrim.slice(0, 2000),
  });

  const grant = await db.get(`SELECT * FROM v2_org_credit_grants WHERE id = ?`, [id]);
  return { ok: true, grant };
}

async function revokeCreditGrant({ orgId, grantId, reason, actorEmail } = {}) {
  const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
  if (reasonTrim.length < 4) {
    return { ok: false, status: 400, error: 'reason required (4+ chars)' };
  }
  const grant = await db.get(
    `SELECT * FROM v2_org_credit_grants WHERE id = ? AND org_id = ?`,
    [grantId, orgId]
  );
  if (!grant) return { ok: false, status: 404, error: 'Credit grant not found' };
  if (grant.revoked_at) return { ok: false, status: 400, error: 'Grant is already revoked' };
  if (grant.grant_type !== 'bonus_minutes') {
    return { ok: false, status: 400, error: 'Only bonus_minutes grants can be revoked here' };
  }

  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE v2_org_credit_grants SET revoked_at = ?, revoked_by = ? WHERE id = ?`,
    [nowIso, actorEmail || 'admin', grantId]
  );
  await writeAdminAudit(db, actorEmail, 'admin_revoke_credit_grant', {
    orgId,
    grantId,
    reason: reasonTrim.slice(0, 2000),
  });

  return { ok: true };
}

async function applyStripeBalanceCredit({
  orgId,
  amountCents,
  reason,
  actorEmail,
  stripeClientOverride = null,
} = {}) {
  const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
  if (reasonTrim.length < 4) {
    return { ok: false, status: 400, error: 'reason required (4+ chars)' };
  }
  const cents = Math.round(Number(amountCents) || 0);
  if (!Number.isFinite(cents) || cents < 50 || cents > 500_000) {
    return { ok: false, status: 400, error: 'Credit amount must be between $0.50 (50¢) and $5,000.00' };
  }

  const sub = await db.get(
    `SELECT org_id, stripe_customer_id FROM v2_org_subscriptions WHERE org_id = ?`,
    [orgId]
  );
  if (!sub?.stripe_customer_id) {
    return { ok: false, status: 400, error: 'This account does not have a Stripe customer ID yet' };
  }

  let stripe = stripeClientOverride;
  if (!stripe) {
    const settings = await getStripeSettings();
    if (!isStripeBillingActive(settings)) {
      return { ok: false, status: 400, error: 'Stripe billing is not enabled on this server' };
    }
    stripe = getStripeClient(settings);
  }

  // Negative amount in Stripe Customer Balance adds credit applied automatically to future invoices.
  const txn = await stripe.customers.createBalanceTransaction(sub.stripe_customer_id, {
    amount: -Math.abs(cents),
    currency: 'usd',
    description: `Lalia support credit: ${reasonTrim.slice(0, 200)}`,
  });

  const id = db.uuid();
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO v2_org_credit_grants
     (id, org_id, grant_type, bonus_meeting_minutes, bonus_translation_minutes, amount_cents, stripe_txn_id, expires_at, reason, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      orgId,
      'stripe_balance_cents',
      0,
      0,
      cents,
      txn?.id || null,
      null,
      reasonTrim.slice(0, 2000),
      actorEmail || 'admin',
      createdAt,
    ]
  );

  await writeAdminAudit(db, actorEmail, 'admin_grant_stripe_credit', {
    orgId,
    grantId: id,
    stripeCustomerId: sub.stripe_customer_id,
    stripeTxnId: txn?.id || null,
    amountCents: cents,
    reason: reasonTrim.slice(0, 2000),
  });

  return {
    ok: true,
    grantId: id,
    stripeTxnId: txn?.id || null,
    endingBalanceCents: txn?.ending_balance ?? null,
  };
}

async function waivePendingOverages({ orgId, reason, actorEmail } = {}) {
  const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
  if (reasonTrim.length < 4) {
    return { ok: false, status: 400, error: 'reason required (4+ chars)' };
  }
  const pendingRows = await db.all(
    `SELECT * FROM v2_overage_ledger WHERE org_id = ? AND status IN ('pending', 'pending_payment')`,
    [orgId]
  );
  if (!pendingRows.length) {
    return { ok: false, status: 400, error: 'No pending overage ledger rows to waive for this account' };
  }

  const totalMicros = pendingRows.reduce((acc, r) => acc + (Number(r.amount_micros) || 0), 0);
  const waivedCents = Math.round(totalMicros / 10_000);

  const upd = await db.run(
    `UPDATE v2_overage_ledger SET status = 'waived' WHERE org_id = ? AND status IN ('pending', 'pending_payment')`,
    [orgId]
  );

  const id = db.uuid();
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO v2_org_credit_grants
     (id, org_id, grant_type, bonus_meeting_minutes, bonus_translation_minutes, amount_cents, stripe_txn_id, expires_at, reason, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      orgId,
      'waive_overage',
      0,
      0,
      waivedCents,
      null,
      null,
      reasonTrim.slice(0, 2000),
      actorEmail || 'admin',
      createdAt,
    ]
  );

  await writeAdminAudit(db, actorEmail, 'admin_waive_pending_overages', {
    orgId,
    grantId: id,
    waivedRowCount: upd?.changes || pendingRows.length,
    waivedCents,
    reason: reasonTrim.slice(0, 2000),
  });

  return { ok: true, waivedCount: upd?.changes || pendingRows.length, waivedCents };
}

async function setOrgAdminTags({ orgId, tags, reason, actorEmail } = {}) {
  const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
  if (reasonTrim.length < 4) {
    return { ok: false, status: 400, error: 'reason required (4+ chars)' };
  }
  const org = await db.get(`SELECT id FROM v2_organizations WHERE id = ?`, [orgId]);
  if (!org) return { ok: false, status: 404, error: 'Organization not found' };

  const normalized = normalizeAdminTags(tags);
  await db.run(`UPDATE v2_organizations SET admin_tags_json = ? WHERE id = ?`, [
    normalized.length ? JSON.stringify(normalized) : null,
    orgId,
  ]);

  await writeAdminAudit(db, actorEmail, 'admin_set_org_tags', {
    orgId,
    tags: normalized,
    reason: reasonTrim.slice(0, 2000),
  });

  return { ok: true, tags: normalized };
}

async function listOrgNotes(orgId) {
  return db.all(
    `SELECT * FROM v2_admin_account_notes
     WHERE org_id = ?
     ORDER BY pinned DESC, created_at DESC
     LIMIT 100`,
    [orgId]
  );
}

async function addOrgNote({ orgId, userId = null, body, pinned = false, actorEmail } = {}) {
  const cleanBody = typeof body === 'string' ? body.trim().slice(0, 4000) : '';
  if (cleanBody.length < 2) {
    return { ok: false, status: 400, error: 'Note body is required' };
  }
  const org = await db.get(`SELECT id FROM v2_organizations WHERE id = ?`, [orgId]);
  if (!org) return { ok: false, status: 404, error: 'Organization not found' };

  const id = db.uuid();
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO v2_admin_account_notes (id, org_id, user_id, pinned, body, author_email, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, orgId, userId || null, pinned ? 1 : 0, cleanBody, actorEmail || 'admin', createdAt]
  );
  await writeAdminAudit(db, actorEmail, 'admin_add_org_note', {
    orgId,
    noteId: id,
    pinned: Boolean(pinned),
  });

  const note = await db.get(`SELECT * FROM v2_admin_account_notes WHERE id = ?`, [id]);
  return { ok: true, note };
}

async function togglePinOrgNote({ orgId, noteId, pinned, actorEmail } = {}) {
  const note = await db.get(
    `SELECT * FROM v2_admin_account_notes WHERE id = ? AND org_id = ?`,
    [noteId, orgId]
  );
  if (!note) return { ok: false, status: 404, error: 'Note not found' };
  const nextPinned = pinned !== undefined ? (pinned ? 1 : 0) : note.pinned ? 0 : 1;
  await db.run(`UPDATE v2_admin_account_notes SET pinned = ? WHERE id = ?`, [nextPinned, noteId]);
  await writeAdminAudit(db, actorEmail, 'admin_pin_org_note', {
    orgId,
    noteId,
    pinned: Boolean(nextPinned),
  });
  const updated = await db.get(`SELECT * FROM v2_admin_account_notes WHERE id = ?`, [noteId]);
  return { ok: true, note: updated };
}

async function deleteOrgNote({ orgId, noteId, actorEmail } = {}) {
  const note = await db.get(
    `SELECT * FROM v2_admin_account_notes WHERE id = ? AND org_id = ?`,
    [noteId, orgId]
  );
  if (!note) return { ok: false, status: 404, error: 'Note not found' };
  await db.run(`DELETE FROM v2_admin_account_notes WHERE id = ?`, [noteId]);
  await writeAdminAudit(db, actorEmail, 'admin_delete_org_note', { orgId, noteId });
  return { ok: true };
}

async function getAdminDashboardSnapshot({ days = 14 } = {}) {
  const sparkDays = Math.max(7, Math.min(90, Number(days) || 14));
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const liveCutoffIso = new Date(now - 6 * 3600_000).toISOString();
  const sinceSpark = `-${sparkDays} days`;

  const [
    userSummary,
    orgSummary,
    activeOrgsRow,
    activeUsersRow,
    mtdUsageRow,
    allTimeUsageRow,
    meetingCountsRow,
    recordingsRow,
    calendarsRow,
    botStatsRow,
    signupsByDay,
    meetingsByDay,
    minutesByDay,
    recentSignups,
    openUsageAlerts,
    watchlistCandidates,
  ] = await Promise.all([
    db.get(
      `SELECT
         COUNT(*) AS total_users,
         COALESCE(SUM(CASE WHEN created_at >= datetime('now', 'start of day') THEN 1 ELSE 0 END), 0) AS signups_today,
         COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS signups_7d,
         COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END), 0) AS signups_30d,
         COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-60 days') AND created_at < datetime('now', '-30 days') THEN 1 ELSE 0 END), 0) AS signups_prev_30d
       FROM v2_users`
    ),
    db.get(
      `SELECT
         COUNT(*) AS total_orgs,
         COALESCE(SUM(CASE WHEN account_type = 'personal' THEN 1 ELSE 0 END), 0) AS personal_orgs,
         COALESCE(SUM(CASE WHEN COALESCE(account_type, 'team') != 'personal' THEN 1 ELSE 0 END), 0) AS team_orgs
       FROM v2_organizations`
    ),
    db.get(
      `SELECT
         COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-7 days') THEN org_id END) AS active_orgs_7d,
         COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-30 days') THEN org_id END) AS active_orgs_30d
       FROM v2_meetings
       WHERE org_id IS NOT NULL`
    ),
    db.get(
      `SELECT COUNT(*) AS active_users_30d
       FROM v2_users
       WHERE last_login_at >= datetime('now', '-30 days') OR created_at >= datetime('now', '-7 days')`
    ),
    db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0) AS mtd_meeting_minutes,
         COALESCE(SUM(CASE WHEN event_type = 'translation_minute' THEN quantity ELSE 0 END), 0) AS mtd_translation_minutes,
         COALESCE(SUM(CASE WHEN event_type = 'notetaker_minutes' THEN quantity ELSE 0 END), 0) AS mtd_notetaker_minutes
       FROM v2_usage_events
       WHERE created_at >= datetime('now', 'start of month')`
    ),
    db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0) AS all_meeting_minutes,
         COALESCE(SUM(CASE WHEN event_type = 'translation_minute' THEN quantity ELSE 0 END), 0) AS all_translation_minutes,
         COALESCE(SUM(CASE WHEN event_type = 'notetaker_minutes' THEN quantity ELSE 0 END), 0) AS all_notetaker_minutes
       FROM v2_usage_events`
    ),
    db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= datetime('now', 'start of day') THEN 1 ELSE 0 END), 0) AS meetings_today,
         COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS meetings_7d,
         COALESCE(SUM(CASE WHEN created_at >= datetime('now', 'start of month') THEN 1 ELSE 0 END), 0) AS meetings_mtd,
         COALESCE(SUM(CASE WHEN status = 'live' AND COALESCE(started_at, created_at) >= ? THEN 1 ELSE 0 END), 0) AS live_rooms_now
       FROM v2_meetings`,
      [liveCutoffIso]
    ),
    db
      .get(
        `SELECT COUNT(*) AS rec_count, COALESCE(SUM(size_bytes), 0) AS rec_bytes
         FROM v2_meeting_recordings`
      )
      .catch(() => ({ rec_count: 0, rec_bytes: 0 })),
    db
      .get(
        `SELECT COUNT(*) AS connected_calendars
         FROM v2_calendar_connections
         WHERE status = 'connected'`
      )
      .catch(() => ({ connected_calendars: 0 })),
    db
      .get(
        `SELECT
           COALESCE(SUM(CASE WHEN status IN ('queued','joining','in_waiting_room','in_call','recording','processing') THEN 1 ELSE 0 END), 0) AS active_bots,
           COALESCE(SUM(CASE WHEN status = 'completed' AND created_at >= datetime('now', 'start of month') THEN 1 ELSE 0 END), 0) AS completed_bots_mtd,
           COALESCE(SUM(CASE WHEN status = 'failed' AND created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS failed_bots_7d
         FROM v2_external_bot_sessions`
      )
      .catch(() => ({ active_bots: 0, completed_bots_mtd: 0, failed_bots_7d: 0 })),
    db.all(
      `SELECT date(created_at) AS day, COUNT(*) AS count
       FROM v2_users
       WHERE created_at >= datetime('now', ?)
       GROUP BY date(created_at)
       ORDER BY day ASC`,
      [sinceSpark]
    ),
    db.all(
      `SELECT date(created_at) AS day, COUNT(*) AS count
       FROM v2_meetings
       WHERE created_at >= datetime('now', ?)
       GROUP BY date(created_at)
       ORDER BY day ASC`,
      [sinceSpark]
    ),
    db.all(
      `SELECT date(created_at) AS day, COALESCE(SUM(quantity), 0) AS minutes
       FROM v2_usage_events
       WHERE event_type = 'meeting_participant_minute' AND created_at >= datetime('now', ?)
       GROUP BY date(created_at)
       ORDER BY day ASC`,
      [sinceSpark]
    ),
    db.all(
      `SELECT u.id, u.email, u.display_name, u.created_at, u.last_login_at,
              m.org_id, o.name AS org_name, o.account_type,
              s.plan_id, s.is_comp,
              (SELECT COALESCE(SUM(CASE WHEN ue.event_type = 'meeting_participant_minute' THEN ue.quantity ELSE 0 END), 0)
               FROM v2_usage_events ue
               WHERE ue.org_id = m.org_id AND ue.created_at >= datetime('now', 'start of month')) AS mtd_meeting_minutes
       FROM v2_users u
       LEFT JOIN v2_org_members m ON m.user_id = u.id
       LEFT JOIN v2_organizations o ON o.id = m.org_id
       LEFT JOIN v2_org_subscriptions s ON s.org_id = m.org_id
       ORDER BY datetime(u.created_at) DESC
       LIMIT 10`
    ),
    listUnacknowledgedAdminUsageAlerts(20).catch(() => []),
    db.all(
      `SELECT o.id AS org_id, o.name AS org_name, o.account_type, o.billing_status, o.suspended_at, o.admin_tags_json,
              s.plan_id, s.is_comp, s.comp_label,
              s.custom_included_meeting_minutes, s.custom_included_translation_minutes,
              p.name AS plan_name, p.monthly_price_cents, p.included_meeting_minutes, p.included_translation_minutes,
              (SELECT u.email FROM v2_org_members m JOIN v2_users u ON u.id = m.user_id
               WHERE m.org_id = o.id
               ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, lower(u.email) LIMIT 1) AS owner_email,
              (SELECT COALESCE(SUM(CASE WHEN ue.event_type = 'meeting_participant_minute' THEN ue.quantity ELSE 0 END), 0)
               FROM v2_usage_events ue
               WHERE ue.org_id = o.id AND ue.created_at >= datetime('now', 'start of month')) AS mtd_meeting_minutes,
              (SELECT COALESCE(SUM(CASE WHEN ue.event_type = 'translation_minute' THEN ue.quantity ELSE 0 END), 0)
               FROM v2_usage_events ue
               WHERE ue.org_id = o.id AND ue.created_at >= datetime('now', 'start of month')) AS mtd_translation_minutes,
              (SELECT COALESCE(SUM(cg.bonus_meeting_minutes), 0)
               FROM v2_org_credit_grants cg
               WHERE cg.org_id = o.id AND cg.grant_type = 'bonus_minutes'
                 AND cg.revoked_at IS NULL AND (cg.expires_at IS NULL OR cg.expires_at > ?)) AS bonus_meeting_minutes,
              (SELECT COALESCE(SUM(cg.bonus_translation_minutes), 0)
               FROM v2_org_credit_grants cg
               WHERE cg.org_id = o.id AND cg.grant_type = 'bonus_minutes'
                 AND cg.revoked_at IS NULL AND (cg.expires_at IS NULL OR cg.expires_at > ?)) AS bonus_translation_minutes,
              (SELECT COALESCE(SUM(r.total_cost_usd), 0)
               FROM meeting_cost_rollups r
               LEFT JOIN v2_meetings mt ON mt.livekit_room_name = r.meeting_id
               WHERE COALESCE(r.org_id, mt.org_id) = o.id
                 AND r.computed_at >= CAST(strftime('%s','now','start of month') AS INTEGER) * 1000) AS mtd_cost_usd
       FROM v2_organizations o
       LEFT JOIN v2_org_subscriptions s ON s.org_id = o.id
       LEFT JOIN v2_plans p ON p.id = s.plan_id
       LIMIT 300`,
      [nowIso, nowIso]
    ),
  ]);

  const severityRank = {
    hard_stopped: 6,
    near_hard_cap: 5,
    soft_overage: 4,
    negative_margin: 3,
    running_low: 2,
    high_comp_cost: 1,
  };

  const watchlist = [];
  for (const row of watchlistCandidates || []) {
    const isComp = Number(row.is_comp) === 1;
    const baseMeet =
      row.custom_included_meeting_minutes != null
        ? Number(row.custom_included_meeting_minutes)
        : Number(row.included_meeting_minutes || 0);
    const baseTrans =
      row.custom_included_translation_minutes != null
        ? Number(row.custom_included_translation_minutes)
        : Number(row.included_translation_minutes || 0);
    const bonusMeet = Number(row.bonus_meeting_minutes || 0);
    const bonusTrans = Number(row.bonus_translation_minutes || 0);
    const effMeetLimit = Math.max(0, baseMeet + bonusMeet);
    const effTransLimit = Math.max(0, baseTrans + bonusTrans);
    const usedMeet = Number(row.mtd_meeting_minutes || 0);
    const usedTrans = Number(row.mtd_translation_minutes || 0);
    const mtdCostUsd = Number(row.mtd_cost_usd || 0);
    const priceCents = Number(row.monthly_price_cents || 0);
    const mult = hardCapMultiplier(row.plan_id || 'free');

    const meetPct = !isComp && effMeetLimit > 0 ? Math.round((usedMeet / effMeetLimit) * 100) : 0;
    const transPct = !isComp && effTransLimit > 0 ? Math.round((usedTrans / effTransLimit) * 100) : 0;
    const maxPct = Math.max(meetPct, transPct);

    const flags = [];
    if (!isComp) {
      const meetHardCap = effMeetLimit * mult;
      const transHardCap = effTransLimit * mult;
      if (
        (meetHardCap > 0 && usedMeet >= meetHardCap) ||
        (transHardCap > 0 && usedTrans >= transHardCap)
      ) {
        flags.push('hard_stopped');
      } else if (
        (meetHardCap > 0 && usedMeet >= meetHardCap * 0.9) ||
        (transHardCap > 0 && usedTrans >= transHardCap * 0.9)
      ) {
        flags.push('near_hard_cap');
      } else if (maxPct >= 100) {
        flags.push('soft_overage');
      } else if (maxPct >= 80) {
        flags.push('running_low');
      }

      if (mtdCostUsd >= 1 && Math.round(mtdCostUsd * 100) > priceCents) {
        flags.push('negative_margin');
      }
    } else if (mtdCostUsd >= 2) {
      flags.push('high_comp_cost');
    }

    if (!flags.length) continue;

    const topFlag = flags.sort((a, b) => (severityRank[b] || 0) - (severityRank[a] || 0))[0];
    watchlist.push({
      org_id: row.org_id,
      org_name: row.org_name,
      owner_email: row.owner_email || null,
      account_type: row.account_type || 'team',
      plan_id: row.plan_id || 'free',
      plan_name: row.plan_name || row.plan_id || 'Free',
      is_comp: isComp,
      comp_label: row.comp_label || null,
      admin_tags: parseAdminTags(row.admin_tags_json),
      mtd_meeting_minutes: Math.round(usedMeet),
      effective_meeting_limit: effMeetLimit,
      bonus_meeting_minutes: bonusMeet,
      mtd_translation_minutes: Math.round(usedTrans),
      effective_translation_limit: effTransLimit,
      quota_pct: maxPct,
      mtd_cost_usd: Number(mtdCostUsd.toFixed(4)),
      monthly_price_cents: isComp ? 0 : priceCents,
      flags,
      primary_flag: topFlag,
      rank: severityRank[topFlag] || 0,
    });
  }

  watchlist.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (b.quota_pct !== a.quota_pct) return b.quota_pct - a.quota_pct;
    return b.mtd_cost_usd - a.mtd_cost_usd;
  });

  const signups30d = Number(userSummary?.signups_30d || 0);
  const signupsPrev30d = Number(userSummary?.signups_prev_30d || 0);
  const signupGrowthPct30d =
    signupsPrev30d > 0
      ? Math.round(((signups30d - signupsPrev30d) / signupsPrev30d) * 100)
      : signups30d > 0
        ? 100
        : 0;

  return {
    generatedAt: nowIso,
    sparklineDays: sparkDays,
    growth: {
      totalUsers: Number(userSummary?.total_users || 0),
      newSignupsToday: Number(userSummary?.signups_today || 0),
      newSignups7d: Number(userSummary?.signups_7d || 0),
      newSignups30d: signups30d,
      newSignupsPrev30d: signupsPrev30d,
      signupGrowthPct30d,
      totalOrgs: Number(orgSummary?.total_orgs || 0),
      personalOrgs: Number(orgSummary?.personal_orgs || 0),
      teamOrgs: Number(orgSummary?.team_orgs || 0),
      activeOrgs7d: Number(activeOrgsRow?.active_orgs_7d || 0),
      activeOrgs30d: Number(activeOrgsRow?.active_orgs_30d || 0),
      activeUsers30d: Number(activeUsersRow?.active_users_30d || 0),
    },
    usage: {
      mtdMeetingMinutes: Math.round(Number(mtdUsageRow?.mtd_meeting_minutes || 0)),
      mtdTranslationMinutes: Math.round(Number(mtdUsageRow?.mtd_translation_minutes || 0)),
      mtdNotetakerMinutes: Math.round(Number(mtdUsageRow?.mtd_notetaker_minutes || 0)),
      allTimeMeetingMinutes: Math.round(Number(allTimeUsageRow?.all_meeting_minutes || 0)),
      allTimeTranslationMinutes: Math.round(Number(allTimeUsageRow?.all_translation_minutes || 0)),
      allTimeNotetakerMinutes: Math.round(Number(allTimeUsageRow?.all_notetaker_minutes || 0)),
      meetingsToday: Number(meetingCountsRow?.meetings_today || 0),
      meetings7d: Number(meetingCountsRow?.meetings_7d || 0),
      meetingsMtd: Number(meetingCountsRow?.meetings_mtd || 0),
      liveRoomsNow: Number(meetingCountsRow?.live_rooms_now || 0),
      recordingsCount: Number(recordingsRow?.rec_count || 0),
      recordingsTotalBytes: Number(recordingsRow?.rec_bytes || 0),
    },
    notetakerOps: {
      connectedCalendars: Number(calendarsRow?.connected_calendars || 0),
      activeBots: Number(botStatsRow?.active_bots || 0),
      completedBotsMtd: Number(botStatsRow?.completed_bots_mtd || 0),
      failedBots7d: Number(botStatsRow?.failed_bots_7d || 0),
    },
    sparklines: {
      signupsByDay: signupsByDay || [],
      meetingsByDay: meetingsByDay || [],
      minutesByDay: minutesByDay || [],
    },
    recentSignups: recentSignups || [],
    openUsageAlerts: openUsageAlerts || [],
    watchlist: watchlist.slice(0, 25),
  };
}

module.exports = {
  parseAdminTags,
  normalizeAdminTags,
  recordAndNotifyAdminUsageAlert,
  listUnacknowledgedAdminUsageAlerts,
  acknowledgeAdminUsageAlerts,
  listOrgCreditGrants,
  grantBonusMinutes,
  revokeCreditGrant,
  applyStripeBalanceCredit,
  waivePendingOverages,
  setOrgAdminTags,
  listOrgNotes,
  addOrgNote,
  togglePinOrgNote,
  deleteOrgNote,
  getAdminDashboardSnapshot,
};
