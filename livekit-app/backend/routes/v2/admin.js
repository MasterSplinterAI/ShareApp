const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { requireSuperadmin, writeAdminAudit } = require('../../lib/v2Superadmin');
const { getMonthToDateUsage } = require('../../lib/v2Entitlements');

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
      `SELECT u.id, u.email, u.display_name, u.created_at,
              m.org_id, m.role, o.name AS org_name,
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
      `SELECT o.id, o.name, o.billing_status, o.created_at,
        s.plan_id, s.status AS sub_status, s.is_comp, s.comp_label, s.comp_reason,
        p.monthly_price_cents, p.included_meeting_minutes,
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
      `SELECT s.*, p.name AS plan_name, p.monthly_price_cents, p.included_meeting_minutes
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

module.exports = router;
