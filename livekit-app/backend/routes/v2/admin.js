const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { requireSuperadmin, writeAdminAudit } = require('../../lib/v2Superadmin');
const { getMonthToDateUsage } = require('../../lib/v2Entitlements');

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
         JOIN v2_meetings mt ON mt.livekit_room_name = r.meeting_id
         WHERE mt.org_id = o.id AND r.computed_at >= CAST(strftime('%s','now','start of month') AS INTEGER) * 1000) AS mtd_cost_usd
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
    const costRow = await db.get(
      `SELECT COALESCE(SUM(r.total_cost_usd), 0) AS total_usd
       FROM meeting_cost_rollups r
       JOIN v2_meetings mt ON mt.livekit_room_name = r.meeting_id
       WHERE mt.org_id = ? AND r.computed_at >= CAST(strftime('%s','now','start of month') AS INTEGER) * 1000`,
      [req.params.orgId]
    );
    res.json({
      org,
      subscription: sub,
      members,
      usageThisMonth: usage,
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
      `SELECT mt.org_id, o.name AS org_name,
              COALESCE(SUM(r.total_cost_usd), 0) AS cost_usd,
              COUNT(*) AS meetings,
              s.plan_id, s.is_comp, p.monthly_price_cents,
              (SELECT COALESCE(SUM(CASE WHEN event_type = 'meeting_participant_minute' THEN quantity ELSE 0 END), 0)
               FROM v2_usage_events u WHERE u.org_id = mt.org_id AND u.created_at >= datetime('now', 'start of month')) AS mtd_minutes
       FROM meeting_cost_rollups r
       JOIN v2_meetings mt ON mt.livekit_room_name = r.meeting_id
       JOIN v2_organizations o ON o.id = mt.org_id
       LEFT JOIN v2_org_subscriptions s ON s.org_id = mt.org_id
       LEFT JOIN v2_plans p ON p.id = s.plan_id
       WHERE r.computed_at >= CAST(strftime('%s','now','start of month') AS INTEGER) * 1000
       GROUP BY mt.org_id
       ORDER BY cost_usd DESC
       LIMIT 100`
    );
    const enriched = byOrg.map((row) => ({
      ...row,
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

module.exports = router;
