const db = require('../db/v2Database');

const SETTINGS_ID = 'default';
const DEFAULT_FROM = 'Parley <no-reply@parley.app>';
const PLACEHOLDER_FROM_DOMAIN = 'parley.app';
let cache = null;
let cacheAt = 0;
const CACHE_MS = 3000;

function maskResendKey(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 10) return '••••••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function maskWebhookSecret(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 12) return '••••••••';
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function envResendApiKey() {
  const key = process.env.RESEND_API_KEY;
  return key && String(key).trim() ? String(key).trim() : null;
}

function envResendWebhookSecret() {
  const key = process.env.RESEND_WEBHOOK_SECRET;
  return key && String(key).trim() ? String(key).trim() : null;
}

function envIcsOrganizerDomain() {
  const domain = process.env.PARLEY_ICS_ORGANIZER_DOMAIN;
  return domain && String(domain).trim() ? String(domain).trim().toLowerCase() : null;
}

function envMailFrom() {
  const from = process.env.MAIL_FROM;
  return from && String(from).trim() ? String(from).trim() : null;
}

function envEmailEnabled() {
  return process.env.EMAIL_ENABLED !== 'false';
}

async function loadDbRow() {
  return db.get(`SELECT * FROM v2_platform_email_settings WHERE id = ?`, [SETTINGS_ID]);
}

function mergeSettings(row) {
  const dbEnabled = row ? Boolean(row.email_enabled) : null;
  const dbKey = row?.resend_api_key ? String(row.resend_api_key).trim() : null;
  const dbFrom = row?.mail_from ? String(row.mail_from).trim() : null;
  const dbWebhookSecret = row?.resend_webhook_secret ? String(row.resend_webhook_secret).trim() : null;
  const dbIcsDomain = row?.ics_organizer_domain ? String(row.ics_organizer_domain).trim().toLowerCase() : null;

  const resendApiKey = dbKey || envResendApiKey();
  const mailFrom = dbFrom || envMailFrom() || DEFAULT_FROM;
  const resendWebhookSecret = dbWebhookSecret || envResendWebhookSecret();
  const icsOrganizerDomain = dbIcsDomain || envIcsOrganizerDomain();
  const emailEnabledPreference = dbEnabled !== null ? dbEnabled : envEmailEnabled();
  const emailEnabled = emailEnabledPreference && Boolean(resendApiKey);

  let source = 'environment';
  if (row) {
    source =
      dbKey || dbFrom || dbWebhookSecret || dbIcsDomain || dbEnabled !== null ? 'database' : 'environment';
    if (
      (dbKey || dbFrom || dbWebhookSecret || dbIcsDomain) &&
      (envResendApiKey() || envMailFrom() || envResendWebhookSecret() || envIcsOrganizerDomain())
    ) {
      source = 'mixed';
    }
  }

  return {
    emailEnabled,
    emailEnabledPreference,
    resendApiKey,
    mailFrom,
    resendWebhookSecret,
    icsOrganizerDomain,
    source,
    dbRow: row,
    hasDbKey: Boolean(dbKey),
    hasEnvKey: Boolean(envResendApiKey()),
    hasDbWebhookSecret: Boolean(dbWebhookSecret),
    hasEnvWebhookSecret: Boolean(envResendWebhookSecret()),
    hasDbIcsDomain: Boolean(dbIcsDomain),
    hasEnvIcsDomain: Boolean(envIcsOrganizerDomain()),
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

async function getEmailSettings({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache && now - cacheAt < CACHE_MS) return cache;
  const row = await loadDbRow();
  cache = mergeSettings(row);
  cacheAt = now;
  return cache;
}

function invalidateEmailSettingsCache() {
  cache = null;
  cacheAt = 0;
}

function validateResendApiKey(key) {
  if (!key) return null;
  const trimmed = String(key).trim();
  if (!trimmed.startsWith('re_')) {
    return 'Resend API key must start with re_';
  }
  if (trimmed.length < 20) {
    return 'Resend API key looks too short';
  }
  return null;
}

function validateResendWebhookSecret(secret) {
  if (!secret) return null;
  const trimmed = String(secret).trim();
  if (!trimmed.startsWith('whsec_')) {
    return 'Resend webhook signing secret must start with whsec_';
  }
  if (trimmed.length < 20) {
    return 'Resend webhook signing secret looks too short';
  }
  return null;
}

function validateIcsOrganizerDomain(domain) {
  if (!domain) return null;
  const trimmed = String(domain).trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed)) {
    return 'Organizer domain should look like a bare domain, e.g. meetings.yourdomain.com';
  }
  return null;
}

function extractEmailAddress(fromValue) {
  if (!fromValue) return '';
  const trimmed = String(fromValue).trim();
  const match = trimmed.match(/<([^>]+)>$/) || trimmed.match(/^([^\s@<>]+@[^\s@<>]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function isPlaceholderFromAddress(fromValue) {
  const email = extractEmailAddress(fromValue);
  return email.endsWith(`@${PLACEHOLDER_FROM_DOMAIN}`);
}

function extractDomainFromMailFrom(fromValue) {
  const email = extractEmailAddress(fromValue);
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1) : '';
}

function validateMailFrom(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!/^[^<>\n]+<[^\s@<>]+@[^\s@<>]+>$|^[^\s@<>]+@[^\s@<>]+$/.test(trimmed)) {
    return 'From address should look like "Parley <no-reply@yourdomain.com>"';
  }
  if (isPlaceholderFromAddress(trimmed)) {
    return `Use a domain verified in Resend (not @${PLACEHOLDER_FROM_DOMAIN}). For testing, try onboarding@resend.dev`;
  }
  return null;
}

async function saveEmailSettings(actorEmail, body = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 4) {
    return { ok: false, error: 'reason required (4+ chars)' };
  }

  const row = await loadDbRow();
  const next = {
    email_enabled: row ? Boolean(row.email_enabled) : true,
    resend_api_key: row?.resend_api_key || null,
    mail_from: row?.mail_from || null,
    resend_webhook_secret: row?.resend_webhook_secret || null,
    ics_organizer_domain: row?.ics_organizer_domain || null,
  };

  if (body.emailEnabled !== undefined) {
    next.email_enabled = Boolean(body.emailEnabled);
  }

  if (body.clearResendApiKey) {
    next.resend_api_key = null;
  } else if (body.resendApiKey !== undefined && body.resendApiKey !== '') {
    const err = validateResendApiKey(body.resendApiKey);
    if (err) return { ok: false, error: err };
    next.resend_api_key = String(body.resendApiKey).trim();
  }

  if (body.clearMailFrom) {
    next.mail_from = null;
  } else if (body.mailFrom !== undefined && body.mailFrom !== '') {
    const err = validateMailFrom(body.mailFrom);
    if (err) return { ok: false, error: err };
    next.mail_from = String(body.mailFrom).trim();
  }

  if (body.clearResendWebhookSecret) {
    next.resend_webhook_secret = null;
  } else if (body.resendWebhookSecret !== undefined && body.resendWebhookSecret !== '') {
    const err = validateResendWebhookSecret(body.resendWebhookSecret);
    if (err) return { ok: false, error: err };
    next.resend_webhook_secret = String(body.resendWebhookSecret).trim();
  }

  if (body.clearIcsOrganizerDomain) {
    next.ics_organizer_domain = null;
  } else if (body.icsOrganizerDomain !== undefined && body.icsOrganizerDomain !== '') {
    const err = validateIcsOrganizerDomain(body.icsOrganizerDomain);
    if (err) return { ok: false, error: err };
    next.ics_organizer_domain = String(body.icsOrganizerDomain).trim().toLowerCase();
  }

  const mergedPreview = mergeSettings({
    email_enabled: next.email_enabled ? 1 : 0,
    resend_api_key: next.resend_api_key,
    mail_from: next.mail_from,
    resend_webhook_secret: next.resend_webhook_secret,
    ics_organizer_domain: next.ics_organizer_domain,
    updated_at: row?.updated_at,
    updated_by: row?.updated_by,
  });

  if (next.email_enabled && !mergedPreview.resendApiKey) {
    return { ok: false, error: 'Enter a Resend API key before enabling email delivery' };
  }

  if (next.email_enabled && isPlaceholderFromAddress(mergedPreview.mailFrom)) {
    return {
      ok: false,
      error: `Set a From address on a domain verified in Resend (not @${PLACEHOLDER_FROM_DOMAIN}). For testing, use onboarding@resend.dev`,
    };
  }

  const now = new Date().toISOString();
  if (row) {
    await db.run(
      `UPDATE v2_platform_email_settings
       SET email_enabled = ?, resend_api_key = ?, mail_from = ?,
           resend_webhook_secret = ?, ics_organizer_domain = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [
        next.email_enabled ? 1 : 0,
        next.resend_api_key,
        next.mail_from,
        next.resend_webhook_secret,
        next.ics_organizer_domain,
        now,
        actorEmail,
        SETTINGS_ID,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO v2_platform_email_settings
       (id, email_enabled, resend_api_key, mail_from, resend_webhook_secret, ics_organizer_domain, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        SETTINGS_ID,
        next.email_enabled ? 1 : 0,
        next.resend_api_key,
        next.mail_from,
        next.resend_webhook_secret,
        next.ics_organizer_domain,
        now,
        actorEmail,
      ]
    );
  }

  invalidateEmailSettingsCache();
  const settings = await getEmailSettings({ fresh: true });
  return { ok: true, settings, reason };
}

function toAdminView(settings) {
  const row = settings.dbRow;
  const storedMailFrom = row?.mail_from ? String(row.mail_from).trim() : envMailFrom() || '';
  const storedIcsDomain = row?.ics_organizer_domain
    ? String(row.ics_organizer_domain).trim().toLowerCase()
    : '';
  return {
    emailEnabled: settings.emailEnabled,
    emailEnabledPreference: row ? Boolean(row.email_enabled) : envEmailEnabled(),
    hasResendApiKey: Boolean(settings.resendApiKey),
    resendApiKeyMasked: maskResendKey(settings.resendApiKey),
    mailFrom: storedMailFrom,
    effectiveMailFrom: settings.mailFrom,
    usingDefaultFrom: !storedMailFrom,
    usingPlaceholderFrom: isPlaceholderFromAddress(settings.mailFrom),
    usingEnvKey: settings.hasEnvKey && !settings.hasDbKey,
    hasResendWebhookSecret: Boolean(settings.resendWebhookSecret),
    resendWebhookSecretMasked: maskWebhookSecret(settings.resendWebhookSecret),
    usingEnvWebhookSecret: settings.hasEnvWebhookSecret && !settings.hasDbWebhookSecret,
    icsOrganizerDomain: storedIcsDomain,
    effectiveIcsOrganizerDomain: settings.icsOrganizerDomain || extractDomainFromMailFrom(settings.mailFrom),
    usingEnvIcsDomain: settings.hasEnvIcsDomain && !settings.hasDbIcsDomain,
    source: settings.source,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

async function isMailerConfigured() {
  const settings = await getEmailSettings();
  return Boolean(
    settings.emailEnabled && settings.resendApiKey && !isPlaceholderFromAddress(settings.mailFrom)
  );
}

module.exports = {
  getEmailSettings,
  saveEmailSettings,
  invalidateEmailSettingsCache,
  maskResendKey,
  maskWebhookSecret,
  validateResendWebhookSecret,
  validateIcsOrganizerDomain,
  toAdminView,
  isMailerConfigured,
  isPlaceholderFromAddress,
  extractDomainFromMailFrom,
  DEFAULT_FROM,
};
