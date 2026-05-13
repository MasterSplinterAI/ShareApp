const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { getOrgEntitlements, getMonthToDateUsage } = require('../../lib/v2Entitlements');

function superadminEmails() {
  const raw = process.env.V2_SUPERADMIN_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function requireSuperadmin(req, res, next) {
  const email = (req.v2Auth.email || '').toLowerCase();
  if (!email || !superadminEmails().has(email)) {
    return res.status(403).json({ error: 'Forbidden', code: 'not_superadmin' });
  }
  next();
}

router.get('/me', requireV2Auth, async (req, res) => {
  try {
    const org = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    const ent = await getOrgEntitlements(req.v2Auth.orgId);
    const usage = await getMonthToDateUsage(req.v2Auth.orgId);
    res.json({ org, entitlements: ent, usageThisMonth: usage });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

const ORG_NAME_MIN = 1;
const ORG_NAME_MAX = 128;

router.patch('/me', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden', code: 'forbidden' });
    }
    const body = req.body || {};
    const allowed = new Set(['name']);
    const extra = Object.keys(body).filter((k) => !allowed.has(k));
    if (extra.length) {
      return res.status(400).json({ error: 'Only name may be updated', code: 'invalid_fields' });
    }
    if (typeof body.name !== 'string') {
      return res.status(400).json({ error: 'name is required', code: 'name_required' });
    }
    const trimmed = body.name.trim();
    if (trimmed.length < ORG_NAME_MIN || trimmed.length > ORG_NAME_MAX) {
      return res.status(400).json({
        error: `Name must be between ${ORG_NAME_MIN} and ${ORG_NAME_MAX} characters`,
        code: 'invalid_name_length',
      });
    }
    await db.run(`UPDATE v2_organizations SET name = ? WHERE id = ?`, [trimmed, req.v2Auth.orgId]);
    const org = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    res.json({ org });
  } catch (e) {
    console.error('[orgs/me PATCH]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/members', requireV2Auth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT u.id, u.email, u.display_name, m.role, m.created_at
       FROM v2_org_members m JOIN v2_users u ON u.id = m.user_id
       WHERE m.org_id = ? ORDER BY lower(u.email)`,
      [req.v2Auth.orgId]
    );
    res.json({ members: rows });
  } catch (e) {
    console.error('[orgs/members GET]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/members', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const ent = await getOrgEntitlements(req.v2Auth.orgId);
    if (!ent?.teamWorkspace) {
      return res.status(403).json({
        error: 'Inviting workspace members requires a team plan (e.g. Pro, Business). Individual plans can create meetings and share guest links only.',
        code: 'plan_no_team_workspace',
      });
    }
    const { email, role } = req.body || {};
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const user = await db.get(`SELECT id FROM v2_users WHERE email = ?`, [email.trim().toLowerCase()]);
    if (!user) {
      return res.status(404).json({ error: 'No user with that email — they must sign up first' });
    }
    const exists = await db.get(`SELECT 1 AS x FROM v2_org_members WHERE org_id = ? AND user_id = ?`, [
      req.v2Auth.orgId,
      user.id,
    ]);
    if (exists) return res.status(409).json({ error: 'Already a member' });
    const r = role === 'admin' ? 'admin' : 'member';
    if (r === 'admin' && req.v2Auth.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can add admins' });
    }
    await db.run(`INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)`, [req.v2Auth.orgId, user.id, r]);
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('[orgs/members POST]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/members/:userId', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { role } = req.body || {};
    if (!['member', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'role must be member or admin' });
    }
    if (role === 'admin' && req.v2Auth.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can assign admin' });
    }
    const targetId = req.params.userId;
    if (targetId === req.v2Auth.userId) {
      return res.status(400).json({ error: 'Cannot change your own role here' });
    }
    const row = await db.get(`SELECT role FROM v2_org_members WHERE org_id = ? AND user_id = ?`, [
      req.v2Auth.orgId,
      targetId,
    ]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.role === 'owner') return res.status(403).json({ error: 'Cannot change owner role' });
    await db.run(`UPDATE v2_org_members SET role = ? WHERE org_id = ? AND user_id = ?`, [role, req.v2Auth.orgId, targetId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.delete('/members/:userId', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const targetId = req.params.userId;
    const row = await db.get(`SELECT role FROM v2_org_members WHERE org_id = ? AND user_id = ?`, [
      req.v2Auth.orgId,
      targetId,
    ]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.role === 'owner') return res.status(403).json({ error: 'Cannot remove owner' });
    if (targetId === req.v2Auth.userId) return res.status(400).json({ error: 'Cannot remove yourself' });
    if (row.role === 'admin' && req.v2Auth.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can remove admins' });
    }
    await db.run(`DELETE FROM v2_org_members WHERE org_id = ? AND user_id = ?`, [req.v2Auth.orgId, targetId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/ping', requireV2Auth, requireSuperadmin, async (req, res) => {
  res.json({ ok: true, superadmin: true });
});

router.get('/admin/orgs', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const orgs = await db.all(
      `SELECT o.id, o.name, o.billing_status, o.created_at,
        (SELECT COUNT(*) FROM v2_org_members m WHERE m.org_id = o.id) AS member_count,
        (SELECT COUNT(*) FROM v2_meetings mt WHERE mt.org_id = o.id) AS meeting_count
       FROM v2_organizations o ORDER BY datetime(o.created_at) DESC LIMIT 200`
    );
    res.json({ orgs });
  } catch (e) {
    console.error('[admin/orgs]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/kpis', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const orgCountRow = await db.get(`SELECT COUNT(*) AS c FROM v2_organizations`);
    const planMix = await db.all(
      `SELECT COALESCE(s.plan_id, '(none)') AS plan_id, COUNT(*) AS org_count
       FROM v2_organizations o
       LEFT JOIN v2_org_subscriptions s ON s.org_id = o.id
       GROUP BY s.plan_id
       ORDER BY org_count DESC`
    );
    const billingMix = await db.all(
      `SELECT billing_status, COUNT(*) AS c FROM v2_organizations GROUP BY billing_status ORDER BY c DESC`
    );
    const subStatusMix = await db.all(
      `SELECT COALESCE(status, '(none)') AS status, COUNT(*) AS c FROM v2_org_subscriptions GROUP BY status ORDER BY c DESC`
    );
    res.json({
      orgCount: orgCountRow?.c ?? 0,
      planMix,
      billingStatusMix: billingMix,
      subscriptionStatusMix: subStatusMix,
    });
  } catch (e) {
    console.error('[admin/kpis]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/admin/orgs/:orgId', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { billing_status } = req.body || {};
    if (!billing_status || typeof billing_status !== 'string') {
      return res.status(400).json({ error: 'billing_status required' });
    }
    const nextStatus = billing_status.slice(0, 64);
    const auditId = db.uuid();
    await db.run(
      `INSERT INTO v2_admin_audit_log (id, actor_email, action, payload_json, created_at)
       VALUES (?,?,?,?, datetime('now'))`,
      [
        auditId,
        (req.v2Auth.email || '').slice(0, 320),
        'admin_patch_org_billing_status',
        JSON.stringify({ orgId: req.params.orgId, billing_status: nextStatus }),
      ]
    );
    await db.run(`UPDATE v2_organizations SET billing_status = ? WHERE id = ?`, [nextStatus, req.params.orgId]);
    const org = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.params.orgId]);
    if (!org) return res.status(404).json({ error: 'Not found' });
    res.json({ org });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
