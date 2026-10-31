const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { getOrgEntitlements, getMonthToDateUsage } = require('../../lib/v2Entitlements');
const {
  DEFAULT_ACCENT,
  LOGO_MAX_BYTES,
  LOGO_MIME,
  brandingRelativePath,
  newLogoFileName,
  normalizeAccentColor,
  normalizeWelcomeMessage,
  publicLogoUrl,
  removeLogoFile,
} = require('../../lib/v2Branding');
const { putOrgObject } = require('../../lib/objectStorage');

const { requireSuperadmin, writeAdminAudit } = require('../../lib/v2Superadmin');
const { isValidBillingStatus, BILLING_STATUSES } = require('../../lib/v2OrgLifecycle');
const { TEAM } = require('../../lib/v2Workspace');

function brandingPayload(req, org) {
  return {
    accentColor: normalizeAccentColor(org?.brand_accent_color) || DEFAULT_ACCENT,
    welcomeMessage: org?.brand_welcome_message || '',
    logoUrl: publicLogoUrl(req, org?.id, org?.brand_logo_file),
  };
}

router.get('/me', requireV2Auth, async (req, res) => {
  try {
    const org = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    const ent = await getOrgEntitlements(req.v2Auth.orgId);
    const usage = await getMonthToDateUsage(req.v2Auth.orgId);
    res.json({ org, entitlements: ent, usageThisMonth: usage, branding: brandingPayload(req, org) });
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
    const allowed = new Set(['name', 'makeTeam']);
    const extra = Object.keys(body).filter((k) => !allowed.has(k));
    if (extra.length) {
      return res.status(400).json({ error: 'Only name and makeTeam may be updated', code: 'invalid_fields' });
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
    const current = await db.get(`SELECT account_type FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    if (current?.account_type !== TEAM) {
      if (!body.makeTeam) {
        return res.status(400).json({
          error:
            'Personal accounts use your profile name. Set a team workspace name with makeTeam to invite colleagues.',
          code: 'personal_account',
        });
      }
      await db.run(`UPDATE v2_organizations SET name = ?, account_type = ? WHERE id = ?`, [
        trimmed,
        TEAM,
        req.v2Auth.orgId,
      ]);
    } else {
      await db.run(`UPDATE v2_organizations SET name = ? WHERE id = ?`, [trimmed, req.v2Auth.orgId]);
    }
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
    const { email, role, name } = req.body || {};
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const normEmail = email.trim().toLowerCase();
    const r = role === 'admin' ? 'admin' : 'member';
    if (r === 'admin' && req.v2Auth.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can add admins' });
    }

    const org = await db.get(`SELECT id, name FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    const inviter = await db.get(`SELECT display_name, email FROM v2_users WHERE id = ?`, [req.v2Auth.userId]);
    const inviterLabel = inviter?.display_name || inviter?.email || 'Your team admin';
    const orgName = org?.name || 'your team workspace';

    let user = await db.get(`SELECT id, email, display_name FROM v2_users WHERE LOWER(email) = LOWER(?)`, [normEmail]);
    let createdNewAccount = false;

    if (!user) {
      // Pre-provision the invited member directly into this team workspace so they don't hit a "must sign up first" wall
      const crypto = require('crypto');
      const { hashPassword } = require('../../lib/authAdapter');
      const newUserId = db.uuid();
      const tempPass = crypto.randomBytes(24).toString('base64url');
      const passHash = await hashPassword(tempPass);
      const displayName = (name && String(name).trim().slice(0, 80)) || normEmail.split('@')[0];

      await db.run(
        `INSERT INTO v2_users (id, email, password_hash, display_name) VALUES (?,?,?,?)`,
        [newUserId, normEmail, passHash, displayName]
      );
      user = { id: newUserId, email: normEmail, display_name: displayName };
      createdNewAccount = true;
    }

    const exists = await db.get(`SELECT 1 AS x FROM v2_org_members WHERE org_id = ? AND user_id = ?`, [
      req.v2Auth.orgId,
      user.id,
    ]);
    if (exists) return res.status(409).json({ error: 'Already a member' });

    await db.run(`INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)`, [
      req.v2Auth.orgId,
      user.id,
      r,
    ]);

    // Send an onboarding / workspace-added email
    try {
      const crypto = require('crypto');
      const { sendEmail } = require('../../lib/mailer');
      const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');
      const base = publicFrontendBaseUrl(req) || 'https://lalia.cloud';

      if (createdNewAccount) {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await db.run(
          `INSERT INTO v2_password_resets (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)`,
          [db.uuid(), user.id, tokenHash, expiresAt]
        );
        const setupUrl = `${base}/v2/reset-password?token=${token}`;
        await sendEmail({
          to: normEmail,
          subject: `${inviterLabel} invited you to join ${orgName} on Lalia`,
          text: `${inviterLabel} added you to ${orgName} on Lalia (${r}).\n\nSet your password to sign in and start hosting or calling:\n${setupUrl}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #0f172a;">
              <p style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #2563eb; margin: 0 0 8px;">Team Invitation</p>
              <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">Join ${orgName} on Lalia</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
                ${inviterLabel} added you to <strong>${orgName}</strong> as a <strong>${r}</strong>. Click below to set your password and access your team workspace, meetings, and contacts.
              </p>
              <p style="margin: 0 0 20px;">
                <a href="${setupUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 22px; border-radius: 10px;">
                  Set Password &amp; Join Workspace
                </a>
              </p>
            </div>
          `,
        });
      } else {
        const appUrl = `${base}/v2/app`;
        await sendEmail({
          to: normEmail,
          subject: `You've been added to ${orgName} on Lalia`,
          text: `${inviterLabel} added you to ${orgName} on Lalia (${r}).\n\nOpen your workspace:\n${appUrl}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #0f172a;">
              <p style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #2563eb; margin: 0 0 8px;">Team Workspace</p>
              <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">You’re now a member of ${orgName}</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
                ${inviterLabel} added your account to <strong>${orgName}</strong> (${r}). You can switch between workspaces anytime in the Lalia sidebar.
              </p>
              <p style="margin: 0 0 20px;">
                <a href="${appUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 22px; border-radius: 10px;">
                  Open Lalia Workspace
                </a>
              </p>
            </div>
          `,
        });
      }
    } catch (mailErr) {
      console.warn('[orgs/members POST] invite email warning:', mailErr.message);
    }

    res.status(201).json({ ok: true, createdNewAccount });
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
    const userCountRow = await db.get(`SELECT COUNT(*) AS c FROM v2_users`);
    const mrrRow = await db.get(
      `SELECT COALESCE(SUM(p.monthly_price_cents), 0) AS mrr_cents
       FROM v2_org_subscriptions s
       JOIN v2_plans p ON p.id = s.plan_id
       WHERE lower(s.status) IN ('active', 'trialing') AND COALESCE(s.is_comp, 0) = 0`
    );
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
      userCount: userCountRow?.c ?? 0,
      estimatedMrrCents: mrrRow?.mrr_cents ?? 0,
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
    const { billing_status, reason } = req.body || {};
    if (!isValidBillingStatus(billing_status)) {
      return res.status(400).json({ error: 'Invalid billing_status', allowed: [...BILLING_STATUSES] });
    }
    const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
    if (reasonTrim.length < 4 || reasonTrim.length > 2000) {
      return res.status(400).json({ error: 'reason required (4–2000 characters)', code: 'reason_required' });
    }
    const nextStatus = billing_status.toLowerCase();
    const auditId = db.uuid();
    await writeAdminAudit(db, req.v2Auth.email, 'admin_patch_org_billing_status', {
      orgId: req.params.orgId,
      billing_status: nextStatus,
      reason: reasonTrim.slice(0, 2000),
    });
    await db.run(`UPDATE v2_organizations SET billing_status = ? WHERE id = ?`, [nextStatus, req.params.orgId]);
    const org = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.params.orgId]);
    if (!org) return res.status(404).json({ error: 'Not found' });
    res.json({ org });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES },
  fileFilter(_req, file, cb) {
    if (!LOGO_MIME.has(file.mimetype)) {
      return cb(new Error('Logo must be PNG, JPEG, WebP, or GIF'));
    }
    cb(null, true);
  },
});

router.patch('/me/branding', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden', code: 'forbidden' });
    }
    const { accentColor, welcomeMessage } = req.body || {};
    const updates = [];
    const params = [];

    if (accentColor !== undefined) {
      const color = normalizeAccentColor(accentColor);
      if (!color) {
        return res.status(400).json({ error: 'accentColor must be a hex color like #2563eb' });
      }
      updates.push('brand_accent_color = ?');
      params.push(color);
    }
    if (welcomeMessage !== undefined) {
      updates.push('brand_welcome_message = ?');
      params.push(normalizeWelcomeMessage(welcomeMessage));
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    params.push(req.v2Auth.orgId);
    await db.run(`UPDATE v2_organizations SET ${updates.join(', ')} WHERE id = ?`, params);
    const org = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    res.json({ org, branding: brandingPayload(req, org) });
  } catch (e) {
    console.error('[orgs/me/branding PATCH]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/me/branding/logo', requireV2Auth, (req, res) => {
  logoUpload.single('logo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'logo field required' });
    }
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      const filename = newLogoFileName(req.file.mimetype);
      const org = await db.get(`SELECT brand_logo_file FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
      if (org?.brand_logo_file) {
        await removeLogoFile(req.v2Auth.orgId, org.brand_logo_file);
      }
      await putOrgObject(req.v2Auth.orgId, brandingRelativePath(filename), req.file.buffer, {
        contentType: req.file.mimetype,
      });
      await db.run(`UPDATE v2_organizations SET brand_logo_file = ? WHERE id = ?`, [
        filename,
        req.v2Auth.orgId,
      ]);
      const fresh = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
      res.json({ branding: brandingPayload(req, fresh) });
    } catch (e) {
      console.error('[orgs/me/branding/logo POST]', e);
      res.status(500).json({ error: 'Save failed' });
    }
  });
});

router.delete('/me/branding/logo', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const org = await db.get(`SELECT brand_logo_file FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    await removeLogoFile(req.v2Auth.orgId, org?.brand_logo_file);
    await db.run(`UPDATE v2_organizations SET brand_logo_file = NULL WHERE id = ?`, [req.v2Auth.orgId]);
    const fresh = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    res.json({ branding: brandingPayload(req, fresh) });
  } catch (e) {
    console.error('[orgs/me/branding/logo DELETE]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
