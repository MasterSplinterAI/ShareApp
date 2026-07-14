const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { requireSuperadmin, writeAdminAudit } = require('../../lib/v2Superadmin');
const { getMonthToDateUsage } = require('../../lib/v2Entitlements');
const { isValidBillingStatus, BILLING_STATUSES } = require('../../lib/v2OrgLifecycle');
const { sendEmail } = require('../../lib/mailer');
const { sendPasswordResetEmail } = require('../../lib/passwordReset');
const { getPrefs } = require('../../lib/communicationPrefs');
const {
  getStripeSettings,
  saveStripeSettings,
  isStripeBillingActive,
  getStripeClient,
  toAdminView,
} = require('../../lib/v2StripeSettings');
const {
  getEmailSettings,
  saveEmailSettings,
  toAdminView: toEmailAdminView,
} = require('../../lib/v2EmailSettings');
const {
  getStorageSettings,
  saveStorageSettings,
  toAdminView: toStorageAdminView,
} = require('../../lib/v2StorageSettings');
const { testStorageConnection, resetObjectStorage } = require('../../lib/objectStorage');
const { renderAdminMessage } = require('../../lib/emailTemplates');
const { settleDueOverageCycles, settlePendingOverageForOrgCycle } = require('../../lib/v2OverageSettlement');

function backendBaseUrl() {
  return (process.env.BACKEND_BASE_URL || process.env.PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
}

function requireAuditReason(reason) {
  const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
  if (reasonTrim.length < 4) return null;
  return reasonTrim.slice(0, 2000);
}

/** Billing usage analytics for admin (participant-minutes = sum of each human's time in meetings). */
async function getOrgUsageAnalytics(orgId) {
  const monthToDate = await db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0) AS meeting_minutes,
       COALESCE(SUM(CASE WHEN event_type = 'translation_minute' THEN quantity ELSE 0 END), 0) AS translation_minutes,
       COUNT(DISTINCT date(created_at)) AS active_days,
       COUNT(CASE WHEN event_type = 'meeting_participant_minute' THEN 1 END) AS billing_events
     FROM v2_usage_events
     WHERE org_id = ? AND created_at >= datetime('now', 'start of month')`,
    [orgId]
  );
  const allTime = await db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0) AS meeting_minutes,
       COALESCE(SUM(CASE WHEN event_type = 'translation_minute' THEN quantity ELSE 0 END), 0) AS translation_minutes
     FROM v2_usage_events WHERE org_id = ?`,
    [orgId]
  );
  const byDay = await db.all(
    `SELECT date(created_at) AS day,
            COALESCE(SUM(quantity), 0) AS meeting_minutes
     FROM v2_usage_events
     WHERE org_id = ? AND event_type = 'meeting_participant_minute'
       AND created_at >= datetime('now', 'start of month')
     GROUP BY date(created_at)
     ORDER BY day DESC`,
    [orgId]
  );
  const byMeeting = await db.all(
    `SELECT ue.meeting_id, m.title,
            COALESCE(SUM(ue.quantity), 0) AS meeting_minutes,
            MIN(ue.created_at) AS first_at,
            MAX(ue.created_at) AS last_at
     FROM v2_usage_events ue
     LEFT JOIN v2_meetings m ON m.id = ue.meeting_id
     WHERE ue.org_id = ? AND ue.event_type = 'meeting_participant_minute'
       AND ue.created_at >= datetime('now', 'start of month')
     GROUP BY ue.meeting_id
     ORDER BY meeting_minutes DESC
     LIMIT 20`,
    [orgId]
  );
  return {
    period: 'calendar_month',
    periodLabel: 'Current calendar month (server UTC)',
    monthToDate: {
      meetingMinutes: monthToDate?.meeting_minutes || 0,
      translationMinutes: monthToDate?.translation_minutes || 0,
      activeDays: monthToDate?.active_days || 0,
      billingEvents: monthToDate?.billing_events || 0,
    },
    allTime: {
      meetingMinutes: allTime?.meeting_minutes || 0,
      translationMinutes: allTime?.translation_minutes || 0,
    },
    byDay,
    byMeeting,
  };
}

router.get('/users', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT u.id, u.email, u.display_name, u.created_at, u.disabled_at, u.last_login_at,
              m.org_id, m.role, o.name AS org_name, o.account_type AS org_account_type,
              o.suspended_at AS org_suspended_at,
              s.plan_id, s.status AS sub_status, s.is_comp, s.comp_label,
              (SELECT COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0)
               FROM v2_usage_events WHERE org_id = m.org_id AND created_at >= datetime('now', 'start of month')) AS mtd_meeting_minutes
       FROM v2_users u
       LEFT JOIN v2_org_members m ON m.user_id = u.id
       LEFT JOIN v2_organizations o ON o.id = m.org_id
       LEFT JOIN v2_org_subscriptions s ON s.org_id = m.org_id
       ORDER BY datetime(u.created_at) DESC
       LIMIT 500`
    );
    res.json({ users: rows });
  } catch (e) {
    console.error('[admin/users]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/orgs', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const orgs = await db.all(
      `SELECT o.id, o.name, o.billing_status, o.account_type, o.created_at, o.suspended_at, o.suspended_reason,
        s.plan_id, s.status AS sub_status, s.is_comp, s.comp_label, s.comp_reason,
        p.monthly_price_cents, p.included_meeting_minutes,
        s.stripe_customer_id, s.stripe_subscription_id,
        (SELECT COUNT(*) FROM v2_org_members m WHERE m.org_id = o.id) AS member_count,
        (SELECT COUNT(*) FROM v2_meetings mt WHERE mt.org_id = o.id) AS meeting_count,
        (SELECT COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0)
         FROM v2_usage_events WHERE org_id = o.id AND created_at >= datetime('now', 'start of month')) AS mtd_meeting_minutes,
        (SELECT COALESCE(SUM(r.total_cost_usd), 0)
         FROM meeting_cost_rollups r
         LEFT JOIN v2_meetings mt ON mt.livekit_room_name = r.meeting_id
         WHERE COALESCE(r.org_id, mt.org_id) = o.id
           AND r.computed_at >= CAST(strftime('%s','now','start of month') AS INTEGER) * 1000) AS mtd_cost_usd
       FROM v2_organizations o
       LEFT JOIN v2_org_subscriptions s ON s.org_id = o.id
       LEFT JOIN v2_plans p ON p.id = s.plan_id
       ORDER BY datetime(o.created_at) DESC LIMIT 200`
    );
    res.json({ orgs });
  } catch (e) {
    console.error('[admin/orgs]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/orgs/:orgId', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const org = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.params.orgId]);
    if (!org) return res.status(404).json({ error: 'Not found' });
    const sub = await db.get(
      `SELECT s.*, p.name AS plan_name, p.monthly_price_cents, p.included_meeting_minutes,
              p.stripe_price_id
       FROM v2_org_subscriptions s
       LEFT JOIN v2_plans p ON p.id = s.plan_id
       WHERE s.org_id = ?`,
      [req.params.orgId]
    );
    const members = await db.all(
      `SELECT u.id, u.email, u.display_name, m.role, m.created_at
       FROM v2_org_members m JOIN v2_users u ON u.id = m.user_id
       WHERE m.org_id = ? ORDER BY lower(u.email)`,
      [req.params.orgId]
    );
    const usage = await getMonthToDateUsage(req.params.orgId);
    const usageAnalytics = await getOrgUsageAnalytics(req.params.orgId);
    const costRow = await db.get(
      `SELECT COALESCE(SUM(r.total_cost_usd), 0) AS total_usd
       FROM meeting_cost_rollups r
       LEFT JOIN v2_meetings mt ON mt.livekit_room_name = r.meeting_id
       WHERE COALESCE(r.org_id, mt.org_id) = ? AND r.computed_at >= CAST(strftime('%s','now','start of month') AS INTEGER) * 1000`,
      [req.params.orgId]
    );
    res.json({
      org,
      subscription: sub,
      members,
      usageThisMonth: usage,
      usageAnalytics,
      costThisMonthUsd: costRow?.total_usd || 0,
      stripeDashboardBase: 'https://dashboard.stripe.com',
    });
  } catch (e) {
    console.error('[admin/org detail]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/orgs/:orgId/plan', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { plan_id, reason } = req.body || {};
    if (!plan_id || typeof plan_id !== 'string') {
      return res.status(400).json({ error: 'plan_id required' });
    }
    const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
    if (reasonTrim.length < 4) {
      return res.status(400).json({ error: 'reason required (4+ chars)' });
    }
    const plan = await db.get(`SELECT id FROM v2_plans WHERE id = ?`, [plan_id]);
    if (!plan) return res.status(400).json({ error: 'Unknown plan' });
    const exists = await db.get(`SELECT org_id FROM v2_org_subscriptions WHERE org_id = ?`, [req.params.orgId]);
    if (!exists) return res.status(404).json({ error: 'Org subscription not found' });

    await writeAdminAudit(db, req.v2Auth.email, 'admin_set_plan', {
      orgId: req.params.orgId,
      plan_id,
      reason: reasonTrim,
    });
    await db.run(`UPDATE v2_org_subscriptions SET plan_id = ? WHERE org_id = ?`, [plan_id, req.params.orgId]);
    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.params.orgId]);
    res.json({ subscription: sub });
  } catch (e) {
    console.error('[admin/set plan]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/orgs/:orgId/comp', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { is_comp, comp_label, reason } = req.body || {};
    const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
    if (reasonTrim.length < 4) {
      return res.status(400).json({ error: 'reason required (4+ chars)' });
    }
    const comp = Boolean(is_comp);
    const label = comp && comp_label ? String(comp_label).slice(0, 64) : null;
    const exists = await db.get(`SELECT org_id FROM v2_org_subscriptions WHERE org_id = ?`, [req.params.orgId]);
    if (!exists) return res.status(404).json({ error: 'Org subscription not found' });

    await writeAdminAudit(db, req.v2Auth.email, 'admin_set_comp', {
      orgId: req.params.orgId,
      is_comp: comp,
      comp_label: label,
      reason: reasonTrim,
    });
    await db.run(
      `UPDATE v2_org_subscriptions SET
         is_comp = ?,
         comp_label = ?,
         comp_reason = ?,
         comp_set_by = ?,
         comp_set_at = datetime('now')
       WHERE org_id = ?`,
      [comp ? 1 : 0, label, reasonTrim.slice(0, 2000), req.v2Auth.email, req.params.orgId]
    );
    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.params.orgId]);
    res.json({ subscription: sub });
  } catch (e) {
    console.error('[admin/set comp]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/costs/summary', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const totals = await db.get(
      `SELECT COALESCE(SUM(r.total_cost_usd), 0) AS total_cost_usd,
              COUNT(*) AS meeting_count
       FROM meeting_cost_rollups r
       WHERE r.computed_at >= CAST(strftime('%s','now','start of month') AS INTEGER) * 1000`
    );
    const byOrg = await db.all(
      `SELECT COALESCE(r.org_id, mt.org_id) AS org_id, o.name AS org_name,
              COALESCE(SUM(r.total_cost_usd), 0) AS cost_usd,
              COUNT(*) AS meetings,
              s.plan_id, s.is_comp, p.monthly_price_cents,
              (SELECT COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0)
               FROM v2_usage_events u WHERE u.org_id = COALESCE(r.org_id, mt.org_id) AND u.created_at >= datetime('now', 'start of month')) AS mtd_minutes
       FROM meeting_cost_rollups r
       LEFT JOIN v2_meetings mt ON mt.livekit_room_name = r.meeting_id
       LEFT JOIN v2_organizations o ON o.id = COALESCE(r.org_id, mt.org_id)
       LEFT JOIN v2_org_subscriptions s ON s.org_id = COALESCE(r.org_id, mt.org_id)
       LEFT JOIN v2_plans p ON p.id = s.plan_id
       WHERE r.computed_at >= CAST(strftime('%s','now','start of month') AS INTEGER) * 1000
       GROUP BY COALESCE(r.org_id, mt.org_id)
       ORDER BY cost_usd DESC
       LIMIT 100`
    );
    // Org-less meetings (guest rooms started from a bare invite link) still cost
    // real STT/LLM money — surface them as an explicit bucket instead of hiding them.
    const enriched = byOrg.map((row) => ({
      ...row,
      org_name: row.org_id ? row.org_name : 'No organization (guest rooms)',
      revenue_cents: row.is_comp === 1 ? 0 : row.monthly_price_cents || 0,
      margin_cents: (row.is_comp === 1 ? 0 : row.monthly_price_cents || 0) - Math.round((row.cost_usd || 0) * 100),
    }));
    res.json({ totals, byOrg: enriched });
  } catch (e) {
    console.error('[admin/costs]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/audit', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, actor_email, action, payload_json, created_at
       FROM v2_admin_audit_log ORDER BY datetime(created_at) DESC LIMIT 100`
    );
    res.json({ entries: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

router.get('/trends', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const days = clampInt(req.query.days, 30, 1, 365);
    const since = `-${days} days`;
    const signupsByDay = await db.all(
      `SELECT date(created_at) AS day, COUNT(*) AS count
       FROM v2_users
       WHERE created_at >= datetime('now', ?)
       GROUP BY date(created_at)
       ORDER BY day ASC
       LIMIT 400`,
      [since]
    );
    const meetingsByDay = await db.all(
      `SELECT date(created_at) AS day, COUNT(*) AS count
       FROM v2_meetings
       WHERE created_at >= datetime('now', ?)
       GROUP BY date(created_at)
       ORDER BY day ASC
       LIMIT 400`,
      [since]
    );
    const minutesByDay = await db.all(
      `SELECT date(created_at) AS day, COALESCE(SUM(quantity), 0) AS minutes
       FROM v2_usage_events
       WHERE event_type = 'meeting_participant_minute' AND created_at >= datetime('now', ?)
       GROUP BY date(created_at)
       ORDER BY day ASC
       LIMIT 400`,
      [since]
    );
    res.json({ days, signupsByDay, meetingsByDay, minutesByDay });
  } catch (e) {
    console.error('[admin/trends]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/meetings', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const orgId = typeof req.query.org_id === 'string' && req.query.org_id ? req.query.org_id : null;
    const params = [];
    let where = '';
    if (orgId) {
      where = 'WHERE m.org_id = ?';
      params.push(orgId);
    }
    params.push(limit);
    const meetings = await db.all(
      `SELECT m.id, m.title, m.status, m.created_at, m.scheduled_start, m.scheduled_end,
              m.started_at, m.ended_at, m.livekit_room_name, m.org_id, o.name AS org_name,
              (SELECT COALESCE(SUM(ue.quantity), 0) FROM v2_usage_events ue
                WHERE ue.meeting_id = m.id AND ue.event_type = 'meeting_participant_minute') AS participant_minutes,
              r.total_cost_usd, r.duration_seconds
       FROM v2_meetings m
       LEFT JOIN v2_organizations o ON o.id = m.org_id
       LEFT JOIN meeting_cost_rollups r ON r.meeting_id = m.livekit_room_name
       ${where}
       ORDER BY datetime(m.created_at) DESC
       LIMIT ?`,
      params
    );
    res.json({ meetings });
  } catch (e) {
    console.error('[admin/meetings]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/meetings/:meetingId/costs', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const meetingId = req.params.meetingId;
    // Cost tables key off the LiveKit room name; accept either a v2_meetings.id or a room name.
    const meeting = await db.get(
      `SELECT m.id, m.title, m.status, m.org_id, m.livekit_room_name, m.created_at, o.name AS org_name
       FROM v2_meetings m
       LEFT JOIN v2_organizations o ON o.id = m.org_id
       WHERE m.id = ? OR m.livekit_room_name = ?`,
      [meetingId, meetingId]
    );
    const roomName = meeting?.livekit_room_name || meetingId;
    const rows = await db.all(
      `SELECT id, event_type, provider, units, unit_cost_usd, total_cost_usd, ts, meta_json
       FROM meeting_cost_events
       WHERE meeting_id IN (?, ?)
       ORDER BY ts ASC
       LIMIT 1000`,
      [roomName, meetingId]
    );
    const events = rows.map((row) => {
      let participant = null;
      try {
        const meta = row.meta_json ? JSON.parse(row.meta_json) : null;
        participant =
          meta?.participant || meta?.participant_identity || meta?.identity || meta?.participantIdentity || null;
      } catch {
        /* malformed meta_json — leave participant null */
      }
      return {
        id: row.id,
        event_type: row.event_type,
        provider: row.provider,
        units: row.units,
        unit_cost_usd: row.unit_cost_usd,
        total_cost_usd: row.total_cost_usd,
        participant,
        created_at: new Date(row.ts).toISOString(),
      };
    });
    const rollupRow = await db.get(
      `SELECT meeting_id, org_id, total_cost_usd, breakdown_json, duration_seconds, computed_at
       FROM meeting_cost_rollups WHERE meeting_id IN (?, ?)`,
      [roomName, meetingId]
    );
    let rollup = null;
    if (rollupRow) {
      let breakdown = null;
      try {
        breakdown = rollupRow.breakdown_json ? JSON.parse(rollupRow.breakdown_json) : null;
      } catch {
        /* keep null */
      }
      rollup = {
        meeting_id: rollupRow.meeting_id,
        org_id: rollupRow.org_id,
        total_cost_usd: rollupRow.total_cost_usd,
        duration_seconds: rollupRow.duration_seconds,
        computed_at: rollupRow.computed_at ? new Date(rollupRow.computed_at).toISOString() : null,
        breakdown,
      };
    }
    res.json({ meeting: meeting || null, events, rollup });
  } catch (e) {
    console.error('[admin/meeting costs]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/guests', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const days = clampInt(req.query.days, 30, 1, 365);
    const sinceMs = Date.now() - days * 86400000;
    const rows = await db.all(
      `SELECT e.id, e.meeting_id AS room, e.org_id, e.participant_identity, e.payload_json, e.ts AS joined_ts,
              (SELECT MIN(l.ts) FROM meeting_events l
                WHERE l.meeting_id = e.meeting_id
                  AND l.participant_identity = e.participant_identity
                  AND l.event_type = 'participant_left'
                  AND l.ts >= e.ts) AS left_ts
       FROM meeting_events e
       WHERE e.event_type = 'participant_joined' AND e.ts >= ?
       ORDER BY e.ts DESC
       LIMIT 500`,
      [sinceMs]
    );
    const participants = rows.map((row) => {
      let name = null;
      try {
        const payload = row.payload_json ? JSON.parse(row.payload_json) : null;
        name = payload?.participant?.name || null;
      } catch {
        /* malformed payload_json — leave name null */
      }
      return {
        room: row.room,
        org_id: row.org_id,
        identity: row.participant_identity,
        name,
        joined_at: new Date(row.joined_ts).toISOString(),
        left_at: row.left_ts ? new Date(row.left_ts).toISOString() : null,
        duration_minutes: row.left_ts ? Math.round((row.left_ts - row.joined_ts) / 60000) : null,
      };
    });
    res.json({
      days,
      participants,
      notes:
        'meeting_events stores raw LiveKit lifecycle webhooks and does not flag guest vs member — all participants are listed. ' +
        'Leave time is paired with the next participant_left for the same identity in the same room, so rejoin sessions may merge.',
    });
  } catch (e) {
    console.error('[admin/guests]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/webhooks', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const rows = await db.all(
      `SELECT id, provider, type, received_at, processed_at
       FROM v2_webhook_events
       ORDER BY datetime(received_at) DESC
       LIMIT ?`,
      [limit]
    );
    const counts = await db.get(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN processed_at IS NULL THEN 1 ELSE 0 END), 0) AS unprocessed
       FROM v2_webhook_events`
    );
    res.json({
      events: rows.map((row) => ({ ...row, processed: Boolean(row.processed_at) })),
      totals: { total: counts?.total || 0, unprocessed: counts?.unprocessed || 0 },
      notes: 'v2_webhook_events has no failure column — health is approximated as processed_at IS NULL (unprocessed).',
    });
  } catch (e) {
    console.error('[admin/webhooks]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

// --- Phase 1: Account lifecycle ---

router.post('/orgs/:orgId/suspend', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const reason = requireAuditReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'reason required (4+ chars)' });
    const org = await db.get(`SELECT id FROM v2_organizations WHERE id = ?`, [req.params.orgId]);
    if (!org) return res.status(404).json({ error: 'Not found' });
    await writeAdminAudit(db, req.v2Auth.email, 'admin_suspend_org', { orgId: req.params.orgId, reason });
    await db.run(
      `UPDATE v2_organizations SET suspended_at = datetime('now'), suspended_reason = ?, billing_status = 'suspended' WHERE id = ?`,
      [reason, req.params.orgId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/suspend org]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/orgs/:orgId/reactivate', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const reason = requireAuditReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'reason required (4+ chars)' });
    const org = await db.get(`SELECT id FROM v2_organizations WHERE id = ?`, [req.params.orgId]);
    if (!org) return res.status(404).json({ error: 'Not found' });
    await writeAdminAudit(db, req.v2Auth.email, 'admin_reactivate_org', { orgId: req.params.orgId, reason });
    await db.run(
      `UPDATE v2_organizations SET suspended_at = NULL, suspended_reason = NULL, billing_status = 'active' WHERE id = ?`,
      [req.params.orgId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/reactivate org]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/users/:userId/disable', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const reason = requireAuditReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'reason required (4+ chars)' });
    const user = await db.get(`SELECT id FROM v2_users WHERE id = ?`, [req.params.userId]);
    if (!user) return res.status(404).json({ error: 'Not found' });
    await writeAdminAudit(db, req.v2Auth.email, 'admin_disable_user', { userId: req.params.userId, reason });
    await db.run(`UPDATE v2_users SET disabled_at = datetime('now') WHERE id = ?`, [req.params.userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/disable user]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/users/:userId/enable', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const reason = requireAuditReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'reason required (4+ chars)' });
    const user = await db.get(`SELECT id FROM v2_users WHERE id = ?`, [req.params.userId]);
    if (!user) return res.status(404).json({ error: 'Not found' });
    await writeAdminAudit(db, req.v2Auth.email, 'admin_enable_user', { userId: req.params.userId, reason });
    await db.run(`UPDATE v2_users SET disabled_at = NULL WHERE id = ?`, [req.params.userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/enable user]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/orgs/:orgId/billing-status', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { billing_status, reason } = req.body || {};
    if (!isValidBillingStatus(billing_status)) {
      return res.status(400).json({
        error: 'Invalid billing_status',
        allowed: [...BILLING_STATUSES],
      });
    }
    const reasonTrim = requireAuditReason(reason);
    if (!reasonTrim) return res.status(400).json({ error: 'reason required (4+ chars)' });
    await writeAdminAudit(db, req.v2Auth.email, 'admin_patch_org_billing_status', {
      orgId: req.params.orgId,
      billing_status,
      reason: reasonTrim,
    });
    await db.run(`UPDATE v2_organizations SET billing_status = ? WHERE id = ?`, [billing_status, req.params.orgId]);
    const org = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.params.orgId]);
    if (!org) return res.status(404).json({ error: 'Not found' });
    res.json({ org });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

// --- Phase 2: Plan management ---

router.get('/plans', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const plans = await db.all(`SELECT * FROM v2_plans ORDER BY monthly_price_cents ASC`);
    res.json({ plans });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/plans/:planId', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const reason = requireAuditReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'reason required (4+ chars)' });
    const plan = await db.get(`SELECT * FROM v2_plans WHERE id = ?`, [req.params.planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const {
      name,
      monthly_price_cents,
      included_meeting_minutes,
      included_translation_minutes,
      overage_meeting_cents_per_min,
      overage_translation_cents_per_min,
      stripe_price_id,
    } = req.body || {};
    const updates = [];
    const params = [];
    if (name != null) {
      updates.push('name = ?');
      params.push(String(name).slice(0, 80));
    }
    if (monthly_price_cents != null) {
      updates.push('monthly_price_cents = ?');
      params.push(Math.max(0, Number(monthly_price_cents) || 0));
    }
    if (included_meeting_minutes != null) {
      updates.push('included_meeting_minutes = ?');
      params.push(Math.max(0, Number(included_meeting_minutes) || 0));
    }
    if (included_translation_minutes != null) {
      updates.push('included_translation_minutes = ?');
      params.push(Math.max(0, Number(included_translation_minutes) || 0));
    }
    if (overage_meeting_cents_per_min != null) {
      updates.push('overage_meeting_cents_per_min = ?');
      params.push(Math.max(0, Number(overage_meeting_cents_per_min) || 0));
    }
    if (overage_translation_cents_per_min != null) {
      updates.push('overage_translation_cents_per_min = ?');
      params.push(Math.max(0, Number(overage_translation_cents_per_min) || 0));
    }
    if (stripe_price_id !== undefined) {
      const priceId = stripe_price_id ? String(stripe_price_id).trim().slice(0, 128) : null;
      if (priceId && !priceId.startsWith('price_')) {
        return res.status(400).json({
          error:
            'stripe_price_id must be a Stripe Price ID starting with price_ (not a Product ID like prod_…)',
        });
      }
      updates.push('stripe_price_id = ?');
      params.push(priceId);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    await writeAdminAudit(db, req.v2Auth.email, 'admin_patch_plan', {
      planId: req.params.planId,
      reason,
      body: req.body,
    });
    params.push(req.params.planId);
    await db.run(`UPDATE v2_plans SET ${updates.join(', ')} WHERE id = ?`, params);
    const fresh = await db.get(`SELECT * FROM v2_plans WHERE id = ?`, [req.params.planId]);
    res.json({ plan: fresh });
  } catch (e) {
    console.error('[admin/patch plan]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/orgs/:orgId/limits', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const reason = requireAuditReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'reason required (4+ chars)' });
    const exists = await db.get(`SELECT org_id FROM v2_org_subscriptions WHERE org_id = ?`, [req.params.orgId]);
    if (!exists) return res.status(404).json({ error: 'Org subscription not found' });
    const { custom_included_meeting_minutes, custom_included_translation_minutes, clearCustom } = req.body || {};
    let meetingVal = custom_included_meeting_minutes;
    let translationVal = custom_included_translation_minutes;
    if (clearCustom) {
      meetingVal = null;
      translationVal = null;
    } else {
      if (meetingVal != null) meetingVal = Math.max(0, Number(meetingVal) || 0);
      if (translationVal != null) translationVal = Math.max(0, Number(translationVal) || 0);
    }
    await writeAdminAudit(db, req.v2Auth.email, 'admin_patch_org_limits', {
      orgId: req.params.orgId,
      reason,
      custom_included_meeting_minutes: meetingVal,
      custom_included_translation_minutes: translationVal,
    });
    await db.run(
      `UPDATE v2_org_subscriptions SET custom_included_meeting_minutes = ?, custom_included_translation_minutes = ? WHERE org_id = ?`,
      [meetingVal, translationVal, req.params.orgId]
    );
    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.params.orgId]);
    res.json({ subscription: sub });
  } catch (e) {
    console.error('[admin/patch org limits]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

// --- Phase 3: Revenue ops ---

router.get('/revenue', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const paidRow = await db.get(
      `SELECT COUNT(*) AS c FROM v2_org_subscriptions s
       WHERE s.plan_id != 'free' AND COALESCE(s.is_comp, 0) = 0 AND lower(s.status) IN ('active', 'trialing')`
    );
    const trialRow = await db.get(
      `SELECT COUNT(*) AS c FROM v2_organizations WHERE billing_status = 'trial'`
    );
    const compRow = await db.get(`SELECT COUNT(*) AS c FROM v2_org_subscriptions WHERE is_comp = 1`);
    const mrrRow = await db.get(
      `SELECT COALESCE(SUM(p.monthly_price_cents), 0) AS mrr_cents
       FROM v2_org_subscriptions s JOIN v2_plans p ON p.id = s.plan_id
       WHERE lower(s.status) IN ('active', 'trialing') AND COALESCE(s.is_comp, 0) = 0 AND s.plan_id != 'free'`
    );
    const paidCount = paidRow?.c || 0;
    const mrrCents = mrrRow?.mrr_cents || 0;
    const webhookNew = await db.get(
      `SELECT COUNT(*) AS c FROM v2_webhook_events
       WHERE type LIKE '%subscription.created%' AND received_at >= datetime('now', 'start of month')`
    );
    const webhookCanceled = await db.get(
      `SELECT COUNT(*) AS c FROM v2_webhook_events
       WHERE type LIKE '%subscription.deleted%' AND received_at >= datetime('now', 'start of month')`
    );
    res.json({
      paidOrgs: paidCount,
      trialOrgs: trialRow?.c || 0,
      compOrgs: compRow?.c || 0,
      estimatedMrrCents: mrrCents,
      arpuCents: paidCount > 0 ? Math.round(mrrCents / paidCount) : 0,
      newSubscriptionsThisMonth: webhookNew?.c || 0,
      cancellationsThisMonth: webhookCanceled?.c || 0,
    });
  } catch (e) {
    console.error('[admin/revenue]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

// --- Phase 4: Support tools ---

router.get('/users/:userId', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const user = await db.get(
      `SELECT id, email, display_name, created_at, disabled_at, last_login_at FROM v2_users WHERE id = ?`,
      [req.params.userId]
    );
    if (!user) return res.status(404).json({ error: 'Not found' });
    const membership = await db.get(
      `SELECT m.org_id, m.role, o.name AS org_name, o.billing_status, o.suspended_at, o.account_type,
              s.plan_id, s.is_comp, s.stripe_customer_id
       FROM v2_org_members m
       LEFT JOIN v2_organizations o ON o.id = m.org_id
       LEFT JOIN v2_org_subscriptions s ON s.org_id = m.org_id
       WHERE m.user_id = ? LIMIT 1`,
      [req.params.userId]
    );
    const recentMeetings = await db.all(
      `SELECT id, title, status, created_at, scheduled_start FROM v2_meetings
       WHERE org_id = ? ORDER BY datetime(created_at) DESC LIMIT 10`,
      [membership?.org_id || '']
    );
    const usage = membership?.org_id ? await getMonthToDateUsage(membership.org_id) : null;
    const communicationPrefs = await getPrefs(req.params.userId);
    res.json({ user, membership, recentMeetings, usageThisMonth: usage, communicationPrefs });
  } catch (e) {
    console.error('[admin/user detail]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/users/:userId/send-password-reset', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const reason = requireAuditReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'reason required (4+ chars)' });
    const result = await sendPasswordResetEmail(req, req.params.userId, { initiatedBy: req.v2Auth.email });
    if (!result.ok) return res.status(404).json({ error: result.error });
    await writeAdminAudit(db, req.v2Auth.email, 'admin_send_password_reset', {
      userId: req.params.userId,
      email: result.email,
      sent: result.sent,
      reason,
    });
    res.json({ ok: true, sent: result.sent, email: result.email });
  } catch (e) {
    console.error('[admin/send password reset]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

// --- Phase 5: Communication ---

router.get('/announcements', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT * FROM v2_announcements ORDER BY datetime(created_at) DESC LIMIT 100`
    );
    res.json({ announcements: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/announcements', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { message, level, starts_at, ends_at } = req.body || {};
    if (!message || typeof message !== 'string' || message.trim().length < 4) {
      return res.status(400).json({ error: 'message required (4+ chars)' });
    }
    const id = db.uuid();
    const lvl = ['info', 'warning', 'critical'].includes(level) ? level : 'info';
    const start = starts_at || new Date().toISOString();
    await writeAdminAudit(db, req.v2Auth.email, 'admin_create_announcement', { id, message: message.slice(0, 2000) });
    await db.run(
      `INSERT INTO v2_announcements (id, message, level, starts_at, ends_at, created_by) VALUES (?,?,?,?,?,?)`,
      [id, message.trim().slice(0, 2000), lvl, start, ends_at || null, req.v2Auth.email]
    );
    const row = await db.get(`SELECT * FROM v2_announcements WHERE id = ?`, [id]);
    res.status(201).json({ announcement: row });
  } catch (e) {
    console.error('[admin/create announcement]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/announcements/:id', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { disabled } = req.body || {};
    const row = await db.get(`SELECT id FROM v2_announcements WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (disabled) {
      await db.run(`UPDATE v2_announcements SET disabled_at = datetime('now') WHERE id = ?`, [req.params.id]);
    } else {
      await db.run(`UPDATE v2_announcements SET disabled_at = NULL WHERE id = ?`, [req.params.id]);
    }
    await writeAdminAudit(db, req.v2Auth.email, 'admin_patch_announcement', { id: req.params.id, disabled: Boolean(disabled) });
    const fresh = await db.get(`SELECT * FROM v2_announcements WHERE id = ?`, [req.params.id]);
    res.json({ announcement: fresh });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/orgs/:orgId/email', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { subject, body, reason } = req.body || {};
    const reasonTrim = requireAuditReason(reason);
    if (!reasonTrim) return res.status(400).json({ error: 'reason required (4+ chars)' });
    if (!subject?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'subject and body required' });
    }
    const owners = await db.all(
      `SELECT u.email FROM v2_org_members m JOIN v2_users u ON u.id = m.user_id
       WHERE m.org_id = ? AND m.role = 'owner'`,
      [req.params.orgId]
    );
    if (!owners.length) return res.status(404).json({ error: 'No owners found' });
    const emails = owners.map((o) => o.email).filter(Boolean);
    const email = renderAdminMessage({ subject: subject.trim(), body: body.trim() });
    const result = await sendEmail({
      to: emails,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    await writeAdminAudit(db, req.v2Auth.email, 'admin_email_org', {
      orgId: req.params.orgId,
      to: emails,
      subject: subject.trim(),
      sent: result.sent,
      reason: reasonTrim,
    });
    res.json({ ok: true, sent: result.sent, recipients: emails });
  } catch (e) {
    console.error('[admin/email org]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/billing/config', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const settings = await getStripeSettings();
    const plans = await db.all(
      `SELECT id, name, stripe_price_id, monthly_price_cents FROM v2_plans ORDER BY monthly_price_cents ASC`
    );
    const withCustomer = await db.get(
      `SELECT COUNT(*) AS c FROM v2_org_subscriptions WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id != ''`
    );
    const withSubscription = await db.get(
      `SELECT COUNT(*) AS c FROM v2_org_subscriptions WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id != ''`
    );
    const base = backendBaseUrl();
    const adminSettings = toAdminView(settings);
    res.json({
      stripeEnabled: isStripeBillingActive(settings),
      stripeKeyMode: settings.stripeKeyMode,
      webhookUrl: base ? `${base}/api/v2/billing/webhook` : null,
      autoChargeEnabled: settings.autoChargeEnabled,
      settings: adminSettings,
      plansConfigured: plans.filter((p) => p.stripe_price_id).length,
      plansTotal: plans.length,
      plans,
      stats: {
        orgsWithStripeCustomer: withCustomer?.c || 0,
        orgsWithStripeSubscription: withSubscription?.c || 0,
      },
      envChecklist: [
        { key: 'STRIPE_ENABLED (env fallback)', ok: process.env.STRIPE_ENABLED === 'true' },
        { key: 'STRIPE_SECRET_KEY (env fallback)', ok: Boolean(process.env.STRIPE_SECRET_KEY) },
        { key: 'STRIPE_WEBHOOK_SECRET (env fallback)', ok: Boolean(process.env.STRIPE_WEBHOOK_SECRET) },
        { key: 'BACKEND_BASE_URL', ok: Boolean(base) },
        {
          key: 'FRONTEND_URL',
          ok: Boolean(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL),
        },
      ],
    });
  } catch (e) {
    console.error('[admin/billing/config]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/billing/config', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const result = await saveStripeSettings(req.v2Auth.email, req.body || {});
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    await writeAdminAudit(db, req.v2Auth.email, 'admin_patch_billing_config', {
      stripeEnabled: result.settings.stripeEnabled,
      autoChargeEnabled: result.settings.autoChargeEnabled,
      stripeKeyMode: result.settings.stripeKeyMode,
      source: result.settings.source,
      reason: result.reason,
    });

    res.json({
      ok: true,
      settings: toAdminView(result.settings),
      stripeEnabled: isStripeBillingActive(result.settings),
    });
  } catch (e) {
    console.error('[admin/billing/config patch]', e);
    res.status(500).json({ error: 'Failed to save billing settings' });
  }
});

router.get('/email/config', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const settings = await getEmailSettings();
    res.json({
      emailEnabled: settings.emailEnabled,
      settings: toEmailAdminView(settings),
      envChecklist: [
        { key: 'RESEND_API_KEY (env fallback)', ok: Boolean(process.env.RESEND_API_KEY) },
        { key: 'MAIL_FROM (env fallback)', ok: Boolean(process.env.MAIL_FROM) },
        { key: 'RESEND_WEBHOOK_SECRET (env fallback)', ok: Boolean(process.env.RESEND_WEBHOOK_SECRET) },
        { key: 'PARLEY_ICS_ORGANIZER_DOMAIN (env fallback)', ok: Boolean(process.env.PARLEY_ICS_ORGANIZER_DOMAIN) },
        { key: 'PUBLIC_FRONTEND_BASE_URL', ok: Boolean(process.env.PUBLIC_FRONTEND_BASE_URL || process.env.FRONTEND_URL) },
      ],
    });
  } catch (e) {
    console.error('[admin/email/config]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/email/config', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const result = await saveEmailSettings(req.v2Auth.email, req.body || {});
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    await writeAdminAudit(db, req.v2Auth.email, 'admin_patch_email_config', {
      emailEnabled: result.settings.emailEnabled,
      source: result.settings.source,
      mailFrom: result.settings.mailFrom,
      reason: result.reason,
    });

    res.json({
      ok: true,
      settings: toEmailAdminView(result.settings),
      emailEnabled: result.settings.emailEnabled,
    });
  } catch (e) {
    console.error('[admin/email/config patch]', e);
    res.status(500).json({ error: 'Failed to save email settings' });
  }
});

router.get('/storage/config', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const settings = await getStorageSettings();
    res.json({
      settings: toStorageAdminView(settings),
      activeDriver: settings.driver,
      envChecklist: [
        { key: 'STORAGE_DRIVER (env fallback)', ok: Boolean(process.env.STORAGE_DRIVER) },
        { key: 'STORAGE_S3_BUCKET (env fallback)', ok: Boolean(process.env.STORAGE_S3_BUCKET) },
        { key: 'STORAGE_S3_ACCESS_KEY_ID (env fallback)', ok: Boolean(process.env.STORAGE_S3_ACCESS_KEY_ID) },
        {
          key: 'STORAGE_S3_SECRET_ACCESS_KEY (env fallback)',
          ok: Boolean(process.env.STORAGE_S3_SECRET_ACCESS_KEY),
        },
      ],
    });
  } catch (e) {
    console.error('[admin/storage/config]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/storage/config', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const result = await saveStorageSettings(req.v2Auth.email, req.body || {});
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    resetObjectStorage();

    await writeAdminAudit(db, req.v2Auth.email, 'admin_patch_storage_config', {
      driver: result.settings.driver,
      source: result.settings.source,
      bucket: result.settings.bucket || null,
      reason: result.reason,
    });

    res.json({
      ok: true,
      settings: toStorageAdminView(result.settings),
      activeDriver: result.settings.driver,
    });
  } catch (e) {
    console.error('[admin/storage/config patch]', e);
    res.status(500).json({ error: 'Failed to save storage settings' });
  }
});

router.post('/storage/test', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const result = await testStorageConnection(req.body || {});
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error('[admin/storage/test]', e);
    res.status(500).json({ ok: false, error: e.message || 'Storage test failed' });
  }
});

router.post('/orgs/:orgId/cancel-subscription', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const reasonTrim = requireAuditReason(req.body?.reason);
    if (!reasonTrim) return res.status(400).json({ error: 'reason required (4+ chars)' });
    const settings = await getStripeSettings();
    if (!isStripeBillingActive(settings)) {
      return res.status(400).json({ error: 'Stripe billing is not enabled on this server' });
    }

    const org = await db.get(`SELECT id, name FROM v2_organizations WHERE id = ?`, [req.params.orgId]);
    if (!org) return res.status(404).json({ error: 'Org not found' });

    const sub = await db.get(`SELECT * FROM v2_org_subscriptions WHERE org_id = ?`, [req.params.orgId]);
    if (!sub?.stripe_subscription_id) {
      return res.status(400).json({ error: 'No Stripe subscription on file for this org' });
    }
    if (sub.is_comp === 1) {
      return res.status(400).json({ error: 'Comp accounts are not billed via Stripe' });
    }

    const cancelAtPeriodEnd = req.body?.cancelAtPeriodEnd !== false;
    const stripe = getStripeClient(settings);
    const result = cancelAtPeriodEnd
      ? await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true })
      : await stripe.subscriptions.cancel(sub.stripe_subscription_id);

    await writeAdminAudit(db, req.v2Auth.email, 'admin_cancel_subscription', {
      orgId: req.params.orgId,
      orgName: org.name,
      subscriptionId: sub.stripe_subscription_id,
      cancelAtPeriodEnd,
      stripeStatus: result.status,
      reason: reasonTrim,
    });

    res.json({
      ok: true,
      status: result.status,
      cancelAtPeriodEnd: Boolean(result.cancel_at_period_end),
      currentPeriodEnd: result.current_period_end
        ? new Date(result.current_period_end * 1000).toISOString()
        : null,
    });
  } catch (e) {
    console.error('[admin/cancel-subscription]', e);
    res.status(500).json({ error: e.message || 'Failed to cancel subscription' });
  }
});

router.get('/consent/marketing', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const filter = String(req.query.filter || 'opted_in').toLowerCase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const summaryRow = await db.get(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(p.marketing_email, 0) = 1 THEN 1 ELSE 0 END) AS opted_in,
         SUM(CASE WHEN COALESCE(p.marketing_email, 0) = 0 THEN 1 ELSE 0 END) AS opted_out
       FROM v2_users u
       LEFT JOIN v2_user_communication_prefs p ON p.user_id = u.id
       WHERE u.disabled_at IS NULL`
    );

    let where = `u.disabled_at IS NULL`;
    const params = [];
    if (filter === 'opted_in') where += ` AND COALESCE(p.marketing_email, 0) = 1`;
    else if (filter === 'opted_out') where += ` AND COALESCE(p.marketing_email, 0) = 0`;
    if (q) {
      where += ` AND (lower(u.email) LIKE ? OR lower(COALESCE(u.display_name, '')) LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }

    const users = await db.all(
      `SELECT u.id, u.email, u.display_name, u.created_at,
              COALESCE(p.marketing_email, 0) AS marketing_email,
              p.prefs_updated_at,
              (SELECT MAX(ce.created_at) FROM v2_consent_events ce
               WHERE ce.user_id = u.id AND ce.consent_type = 'marketing_email' AND ce.granted = 1) AS last_opt_in_at
       FROM v2_users u
       LEFT JOIN v2_user_communication_prefs p ON p.user_id = u.id
       WHERE ${where}
       ORDER BY COALESCE(p.prefs_updated_at, u.created_at) DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const countRow = await db.get(
      `SELECT COUNT(*) AS c
       FROM v2_users u
       LEFT JOIN v2_user_communication_prefs p ON p.user_id = u.id
       WHERE ${where}`,
      params
    );

    res.json({
      summary: {
        total: summaryRow?.total || 0,
        optedIn: summaryRow?.opted_in || 0,
        optedOut: summaryRow?.opted_out || 0,
      },
      users: users.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        createdAt: row.created_at,
        marketingEmail: Boolean(row.marketing_email),
        prefsUpdatedAt: row.prefs_updated_at,
        lastOptInAt: row.last_opt_in_at,
      })),
      pagination: { limit, offset, total: countRow?.c || 0 },
    });
  } catch (e) {
    console.error('[admin/consent/marketing]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/email/broadcast', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { subject, body, reason, confirm } = req.body || {};
    if (confirm !== 'SEND_ALL') {
      return res.status(400).json({ error: 'confirm must be SEND_ALL' });
    }
    const reasonTrim = requireAuditReason(reason);
    if (!reasonTrim) return res.status(400).json({ error: 'reason required (4+ chars)' });
    if (!subject?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'subject and body required' });
    }
    const owners = await db.all(
      `SELECT DISTINCT u.email FROM v2_org_members m JOIN v2_users u ON u.id = m.user_id WHERE m.role = 'owner'`
    );
    const emails = owners.map((o) => o.email).filter(Boolean);
    let sentCount = 0;
    const email = renderAdminMessage({ subject: subject.trim(), body: body.trim() });
    for (const emailAddress of emails) {
      const r = await sendEmail({
        to: emailAddress,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      if (r.sent) sentCount += 1;
    }
    await writeAdminAudit(db, req.v2Auth.email, 'admin_email_broadcast', {
      recipientCount: emails.length,
      sentCount,
      subject: subject.trim(),
      reason: reasonTrim,
    });
    res.json({ ok: true, recipientCount: emails.length, sentCount });
  } catch (e) {
    console.error('[admin/email broadcast]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/billing/settle-overages', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const reason = requireAuditReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'reason required (4+ chars)' });

    const { orgId, cycleId } = req.body || {};
    let result;
    if (orgId && cycleId) {
      result = await settlePendingOverageForOrgCycle(String(orgId), String(cycleId));
    } else {
      result = await settleDueOverageCycles({ orgId: orgId ? String(orgId) : null });
    }

    await writeAdminAudit(db, req.v2Auth.email, 'admin_settle_overages', {
      orgId: orgId || null,
      cycleId: cycleId || null,
      reason,
      resultSummary: Array.isArray(result.results) ? result.results.length : 1,
    });

    res.json({ ok: true, result });
  } catch (e) {
    console.error('[admin/billing/settle-overages]', e);
    res.status(500).json({ error: 'Settlement failed' });
  }
});

module.exports = router;
