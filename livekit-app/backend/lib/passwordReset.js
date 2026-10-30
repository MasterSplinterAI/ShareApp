const crypto = require('crypto');
const db = require('../db/v2Database');
const { sendEmail } = require('./mailer');
const { publicFrontendBaseUrl } = require('./publicFrontendBaseUrl');
const { renderPasswordReset } = require('./emailTemplates');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function resetLinkBase(req) {
  const fromEnv = (process.env.PUBLIC_FRONTEND_BASE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return publicFrontendBaseUrl(req) || 'https://staging.jarmetals.com';
}

/** Mint a password-reset token and email the user. Returns { sent, resetUrl? } for admin audit. */
async function sendPasswordResetEmail(req, userId, { initiatedBy } = {}) {
  const user = await db.get(`SELECT id, email FROM v2_users WHERE id = ?`, [userId]);
  if (!user) return { ok: false, error: 'User not found' };

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  await db.run(
    `INSERT INTO v2_password_resets (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)`,
    [db.uuid(), user.id, sha256Hex(token), expiresAt]
  );
  const resetUrl = `${resetLinkBase(req)}/v2/reset-password?token=${token}`;
  const email = renderPasswordReset({ resetUrl, initiatedBy });
  const result = await sendEmail({
    to: user.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  return { ok: true, sent: result.sent, email: user.email };
}

module.exports = { sendPasswordResetEmail, sha256Hex, RESET_TOKEN_TTL_MS };
