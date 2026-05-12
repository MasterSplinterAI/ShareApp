const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { hashPassword, verifyPassword, signSession } = require('../../lib/authAdapter');

function emailValid(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

router.post('/signup', async (req, res) => {
  try {
    const { email, password, displayName, orgName } = req.body || {};
    if (!emailValid(email) || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'Invalid email or password (min 8 chars)' });
    }
    const org = orgName && String(orgName).trim() ? String(orgName).trim() : `${email.split('@')[0]}'s org`;
    const existing = await db.get(`SELECT id FROM v2_users WHERE email = ?`, [email.trim().toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const userId = db.uuid();
    const orgId = db.uuid();
    const hash = await hashPassword(password);
    await db.run(
      `INSERT INTO v2_users (id, email, password_hash, display_name) VALUES (?,?,?,?)`,
      [userId, email.trim().toLowerCase(), hash, displayName || email.split('@')[0]]
    );
    await db.run(`INSERT INTO v2_organizations (id, name, billing_status) VALUES (?,?,?)`, [orgId, org, 'trial']);
    await db.run(`INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)`, [orgId, userId, 'owner']);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
    await db.run(
      `INSERT INTO v2_org_subscriptions (org_id, plan_id, status, current_period_start, current_period_end) VALUES (?,?,?,?,?)`,
      [orgId, 'starter', 'active', start, end]
    );
    const cycleId = db.uuid();
    await db.run(
      `INSERT INTO v2_billing_cycles (id, org_id, period_start, period_end) VALUES (?,?,?,?)`,
      [cycleId, orgId, start, end]
    );
    const token = signSession({ sub: userId, email: email.trim().toLowerCase(), orgId, role: 'owner' });
    res.status(201).json({ token, user: { id: userId, email: email.trim().toLowerCase(), displayName: displayName || null }, org: { id: orgId, name: org } });
  } catch (e) {
    console.error('[v2/auth/signup]', e);
    res.status(500).json({ error: 'Signup failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!emailValid(email) || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const user = await db.get(`SELECT * FROM v2_users WHERE email = ?`, [email.trim().toLowerCase()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const membership = await db.get(
      `SELECT org_id, role FROM v2_org_members WHERE user_id = ? ORDER BY datetime(created_at) ASC LIMIT 1`,
      [user.id]
    );
    if (!membership) {
      return res.status(403).json({ error: 'No organization membership' });
    }
    const token = signSession({
      sub: user.id,
      email: user.email,
      orgId: membership.org_id,
      role: membership.role,
    });
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name }, orgId: membership.org_id });
  } catch (e) {
    console.error('[v2/auth/login]', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireV2Auth, async (req, res) => {
  try {
    const user = await db.get(`SELECT id, email, display_name FROM v2_users WHERE id = ?`, [req.v2Auth.userId]);
    const org = await db.get(`SELECT id, name, billing_status FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    res.json({ user, org, role: req.v2Auth.role });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
