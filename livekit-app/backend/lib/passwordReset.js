const crypto = require('crypto');
const db = require('../db/v2Database');
const { sendEmail } = require('./mailer');
const { publicFrontendBaseUrl } = require('./publicFrontendBaseUrl');

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
  const result = await sendEmail({
    to: user.email,
    subject: 'Reset your Parley password',
    text: `We received a request to reset your Parley password${initiatedBy ? ` (requested by ${initiatedBy})` : ''}.\n\nReset it here (link expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `<p>We received a request to reset your Parley password${initiatedBy ? ` (requested by ${initiatedBy})` : ''}.</p><p><a href="${resetUrl}">Reset your password</a> (link expires in 1 hour).</p><p>If you didn't request this, you can safely ignore this email.</p>`,
  });
  return { ok: true, sent: result.sent, email: user.email };
}

module.exports = { sendPasswordResetEmail, sha256Hex, RESET_TOKEN_TTL_MS };
