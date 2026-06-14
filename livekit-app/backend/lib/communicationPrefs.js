const db = require('../db/v2Database');

const POLICY_VERSION = Math.max(1, parseInt(process.env.POLICY_VERSION || '1', 10) || 1);

function clientMeta(req) {
  const ip =
    (req.headers['x-forwarded-for'] && String(req.headers['x-forwarded-for']).split(',')[0].trim()) ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;
  const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 512) : null;
  return { ip, userAgent };
}

async function recordConsentEvent(userId, consentType, granted, req) {
  await db.run(
    `INSERT INTO v2_consent_events (id, user_id, consent_type, granted, ip, user_agent, policy_version, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      db.uuid(),
      userId,
      consentType,
      granted ? 1 : 0,
      clientMeta(req).ip,
      clientMeta(req).userAgent,
      POLICY_VERSION,
      new Date().toISOString(),
    ]
  );
}

async function ensureDefaultPrefs(userId, { marketingEmail = false } = {}) {
  const existing = await db.get(`SELECT user_id FROM v2_user_communication_prefs WHERE user_id = ?`, [userId]);
  if (existing) return;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO v2_user_communication_prefs
     (user_id, marketing_email, marketing_sms, marketing_phone, phone_e164, prefs_updated_at, policy_version)
     VALUES (?,?,?,?,?,?,?)`,
    [userId, marketingEmail ? 1 : 0, 0, 0, null, now, POLICY_VERSION]
  );
}

function rowToPrefs(row) {
  if (!row) {
    return {
      marketingEmail: false,
      marketingSms: false,
      marketingPhone: false,
      phoneE164: null,
      policyVersion: POLICY_VERSION,
      prefsUpdatedAt: null,
    };
  }
  return {
    marketingEmail: Boolean(row.marketing_email),
    marketingSms: Boolean(row.marketing_sms),
    marketingPhone: Boolean(row.marketing_phone),
    phoneE164: row.phone_e164 || null,
    policyVersion: row.policy_version ?? POLICY_VERSION,
    prefsUpdatedAt: row.prefs_updated_at || null,
  };
}

async function getPrefs(userId) {
  await ensureDefaultPrefs(userId);
  const row = await db.get(`SELECT * FROM v2_user_communication_prefs WHERE user_id = ?`, [userId]);
  return rowToPrefs(row);
}

async function setSignupPrefs(userId, { marketingEmail = false }, req) {
  await ensureDefaultPrefs(userId, { marketingEmail });
  if (marketingEmail) {
    await recordConsentEvent(userId, 'marketing_email', true, req);
  }
  await recordConsentEvent(userId, 'tos', true, req);
  await recordConsentEvent(userId, 'privacy', true, req);
}

async function updatePrefs(userId, body, req) {
  await ensureDefaultPrefs(userId);
  const current = await db.get(`SELECT * FROM v2_user_communication_prefs WHERE user_id = ?`, [userId]);
  const next = {
    marketingEmail:
      body.marketingEmail !== undefined ? Boolean(body.marketingEmail) : Boolean(current.marketing_email),
    marketingSms: body.marketingSms !== undefined ? Boolean(body.marketingSms) : Boolean(current.marketing_sms),
    marketingPhone:
      body.marketingPhone !== undefined ? Boolean(body.marketingPhone) : Boolean(current.marketing_phone),
    phoneE164:
      body.phoneE164 !== undefined
        ? body.phoneE164 === null || body.phoneE164 === ''
          ? null
          : String(body.phoneE164).trim()
        : current.phone_e164,
  };

  if (next.marketingSms || next.marketingPhone) {
    return { ok: false, error: 'SMS and phone preferences are not available yet' };
  }

  const now = new Date().toISOString();
  await db.run(
    `UPDATE v2_user_communication_prefs
     SET marketing_email = ?, marketing_sms = ?, marketing_phone = ?, phone_e164 = ?,
         prefs_updated_at = ?, policy_version = ?
     WHERE user_id = ?`,
    [
      next.marketingEmail ? 1 : 0,
      next.marketingSms ? 1 : 0,
      next.marketingPhone ? 1 : 0,
      next.phoneE164,
      now,
      POLICY_VERSION,
      userId,
    ]
  );

  if (body.marketingEmail !== undefined && Boolean(body.marketingEmail) !== Boolean(current.marketing_email)) {
    await recordConsentEvent(userId, 'marketing_email', next.marketingEmail, req);
  }

  return { ok: true, prefs: await getPrefs(userId) };
}

module.exports = {
  POLICY_VERSION,
  ensureDefaultPrefs,
  getPrefs,
  setSignupPrefs,
  updatePrefs,
  recordConsentEvent,
};
