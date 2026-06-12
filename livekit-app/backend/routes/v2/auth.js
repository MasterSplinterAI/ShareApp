const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { hashPassword, verifyPassword, signSession } = require('../../lib/authAdapter');
const { sendEmail } = require('../../lib/mailer');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');
const { PERSONAL, TEAM, normalizeAccountTypeHint, resolveNewWorkspace } = require('../../lib/v2Workspace');

function emailValid(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Org + owner membership + free subscription + billing cycle for a user. */
async function provisionOrgForUser(userId, email, { orgName, displayName, accountType: accountTypeHint } = {}) {
  const { accountType, name } = resolveNewWorkspace({
    orgName,
    displayName,
    email,
    accountType: accountTypeHint,
  });
  const orgId = db.uuid();
  await db.run(
    `INSERT INTO v2_organizations (id, name, billing_status, account_type) VALUES (?,?,?,?)`,
    [orgId, name, 'trial', accountType]
  );
  await db.run(`INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)`, [orgId, userId, 'owner']);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
  await db.run(
    `INSERT INTO v2_org_subscriptions (org_id, plan_id, status, current_period_start, current_period_end) VALUES (?,?,?,?,?)`,
    [orgId, 'free', 'active', start, end]
  );
  await db.run(
    `INSERT INTO v2_billing_cycles (id, org_id, period_start, period_end) VALUES (?,?,?,?)`,
    [db.uuid(), orgId, start, end]
  );
  return { orgId, orgName: name, accountType };
}

router.post('/signup', async (req, res) => {
  const cleanup = [];
  try {
    const { email, password, displayName, orgName, accountType: accountTypeRaw } = req.body || {};
    if (!emailValid(email) || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'Invalid email or password (min 8 chars)' });
    }
    const accountTypeHint = normalizeAccountTypeHint(accountTypeRaw);
    const trimmedOrgName = typeof orgName === 'string' ? orgName.trim() : '';
    if (accountTypeHint === TEAM && !trimmedOrgName) {
      return res.status(400).json({ error: 'Company name is required for company accounts' });
    }
    const existing = await db.get(`SELECT id FROM v2_users WHERE email = ?`, [email.trim().toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const userId = db.uuid();
    const hash = await hashPassword(password);
    await db.run(
      `INSERT INTO v2_users (id, email, password_hash, display_name) VALUES (?,?,?,?)`,
      [userId, email.trim().toLowerCase(), hash, displayName || email.split('@')[0]]
    );
    cleanup.push(() => db.run(`DELETE FROM v2_users WHERE id = ?`, [userId]));
    const { orgId, orgName: org, accountType } = await provisionOrgForUser(userId, email, {
      orgName: trimmedOrgName || undefined,
      displayName: displayName || email.split('@')[0],
      accountType: accountTypeHint,
    });
    const token = signSession({ sub: userId, email: email.trim().toLowerCase(), orgId, role: 'owner' });
    res.status(201).json({
      token,
      user: { id: userId, email: email.trim().toLowerCase(), displayName: displayName || null },
      org: { id: orgId, name: org, account_type: accountType },
    });
  } catch (e) {
    console.error('[v2/auth/signup]', e);
    // Compensating cleanup: a half-created account (user without org membership)
    // can't log in and is invisible to org-centric admin views.
    for (const fn of cleanup.reverse()) {
      await fn().catch(() => {});
    }
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
    if (user.disabled_at) {
      return res.status(403).json({ error: 'Account disabled', code: 'account_disabled' });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    let membership = await db.get(
      `SELECT org_id, role FROM v2_org_members WHERE user_id = ? ORDER BY datetime(created_at) ASC LIMIT 1`,
      [user.id]
    );
    if (!membership) {
      // Self-heal orphans from historical non-transactional signups: provision the
      // missing org instead of locking the account out forever.
      console.warn(`[v2/auth/login] repairing org-less user ${user.email}`);
      const { orgId } = await provisionOrgForUser(user.id, user.email, {
        displayName: user.display_name,
      });
      membership = { org_id: orgId, role: 'owner' };
    }
    const org = await db.get(`SELECT suspended_at, billing_status FROM v2_organizations WHERE id = ?`, [
      membership.org_id,
    ]);
    if (org?.suspended_at) {
      return res.status(403).json({ error: 'Workspace suspended', code: 'org_suspended' });
    }
    await db.run(`UPDATE v2_users SET last_login_at = datetime('now') WHERE id = ?`, [user.id]);
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

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function resetLinkBase(req) {
  const fromEnv = (process.env.PUBLIC_FRONTEND_BASE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return publicFrontendBaseUrl(req) || 'https://staging.jarmetals.com';
}

// Light in-memory rate limit for reset attempts (per IP, 5 per 15 min).
const RESET_RATE_WINDOW_MS = 15 * 60 * 1000;
const RESET_RATE_MAX = 5;
const resetAttempts = new Map();

function resetRateLimited(ip) {
  const now = Date.now();
  const entry = resetAttempts.get(ip);
  if (!entry || now - entry.windowStart > RESET_RATE_WINDOW_MS) {
    resetAttempts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RESET_RATE_MAX;
}

// Prevent unbounded growth of the rate-limit map.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of resetAttempts) {
    if (now - entry.windowStart > RESET_RATE_WINDOW_MS) resetAttempts.delete(ip);
  }
}, RESET_RATE_WINDOW_MS).unref();

router.post('/forgot-password', async (req, res) => {
  // Always 200 to avoid account enumeration.
  try {
    const { email } = req.body || {};
    if (!emailValid(email)) {
      return res.json({ ok: true });
    }
    const user = await db.get(`SELECT id, email FROM v2_users WHERE email = ?`, [email.trim().toLowerCase()]);
    if (!user) {
      return res.json({ ok: true });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    await db.run(
      `INSERT INTO v2_password_resets (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)`,
      [db.uuid(), user.id, sha256Hex(token), expiresAt]
    );
    const resetUrl = `${resetLinkBase(req)}/v2/reset-password?token=${token}`;
    await sendEmail({
      to: user.email,
      subject: 'Reset your Parley password',
      text: `We received a request to reset your Parley password.\n\nReset it here (link expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
      html: `<p>We received a request to reset your Parley password.</p><p><a href="${resetUrl}">Reset your password</a> (link expires in 1 hour).</p><p>If you didn't request this, you can safely ignore this email.</p>`,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[v2/auth/forgot-password]', e);
    // Still 200 — never leak internal state or account existence.
    res.json({ ok: true });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    if (resetRateLimited(String(ip))) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Reset token required' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const row = await db.get(
      `SELECT * FROM v2_password_resets WHERE token_hash = ?`,
      [sha256Hex(token)]
    );
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }
    const hash = await hashPassword(String(password));
    await db.run(`UPDATE v2_users SET password_hash = ? WHERE id = ?`, [hash, row.user_id]);
    await db.run(`UPDATE v2_password_resets SET used_at = ? WHERE id = ?`, [new Date().toISOString(), row.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[v2/auth/reset-password]', e);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

const { isSuperadminEmail } = require('../../lib/v2Superadmin');

router.get('/me', requireV2Auth, async (req, res) => {
  try {
    const user = await db.get(`SELECT id, email, display_name FROM v2_users WHERE id = ?`, [req.v2Auth.userId]);
    const org = await db.get(
      `SELECT id, name, billing_status, account_type FROM v2_organizations WHERE id = ?`,
      [req.v2Auth.orgId]
    );
    res.json({
      user,
      org,
      role: req.v2Auth.role,
      isSuperadmin: isSuperadminEmail(req.v2Auth.email),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

const DISPLAY_NAME_MIN = 1;
const DISPLAY_NAME_MAX = 128;

router.patch('/me', requireV2Auth, async (req, res) => {
  try {
    const { displayName } = req.body || {};
    if (displayName === undefined) {
      return res.status(400).json({ error: 'displayName is required' });
    }
    const trimmed = String(displayName).trim();
    if (trimmed.length < DISPLAY_NAME_MIN || trimmed.length > DISPLAY_NAME_MAX) {
      return res.status(400).json({
        error: `Name must be between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX} characters`,
      });
    }
    await db.run(`UPDATE v2_users SET display_name = ? WHERE id = ?`, [trimmed, req.v2Auth.userId]);
    const org = await db.get(`SELECT account_type FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    if (org?.account_type === PERSONAL) {
      await db.run(`UPDATE v2_organizations SET name = ? WHERE id = ?`, [trimmed, req.v2Auth.orgId]);
    }
    const user = await db.get(`SELECT id, email, display_name FROM v2_users WHERE id = ?`, [req.v2Auth.userId]);
    const orgRow = await db.get(
      `SELECT id, name, billing_status, account_type FROM v2_organizations WHERE id = ?`,
      [req.v2Auth.orgId]
    );
    res.json({
      user,
      org: orgRow,
      role: req.v2Auth.role,
      isSuperadmin: isSuperadminEmail(req.v2Auth.email),
    });
  } catch (e) {
    console.error('[v2/auth/me PATCH]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
