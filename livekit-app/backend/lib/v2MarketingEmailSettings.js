const db = require('../db/v2Database');
const { encryptSecret, decryptSecret, isEncrypted } = require('./secretCrypto');
const { getEmailSettings } = require('./v2EmailSettings');
const {
  resolveMarketingEmailConfig,
  marketingWebhookUrl,
  isValidResendWebhookSecret,
  isValidFromAddress,
  maskWebhookSecret,
} = require('./marketingEmailSettings');

const SETTINGS_ID = 'default';

function envMarketingWebhookSecret() {
  const key = process.env.MARKETING_RESEND_WEBHOOK_SECRET;
  return key && String(key).trim() ? String(key).trim() : null;
}

function envMarketingFrom() {
  const from = process.env.MARKETING_EMAIL_FROM;
  return from && String(from).trim() ? String(from).trim() : null;
}

function decryptField(raw) {
  if (!raw) return null;
  try {
    return decryptSecret(String(raw).trim());
  } catch (e) {
    console.warn('[v2MarketingEmailSettings] decrypt failed:', e.message);
    return null;
  }
}

async function loadDbRow() {
  return db.get(`SELECT * FROM v2_platform_email_settings WHERE id = ?`, [SETTINGS_ID]);
}

async function getResolvedMarketingEmailConfig() {
  const [row, transactional] = await Promise.all([loadDbRow(), getEmailSettings()]);
  const dbSecretRaw = row?.marketing_resend_webhook_secret
    ? String(row.marketing_resend_webhook_secret).trim()
    : null;
  const dbFrom = row?.marketing_email_from ? String(row.marketing_email_from).trim() : null;
  return resolveMarketingEmailConfig({
    dbSecret: decryptField(dbSecretRaw),
    envSecret: envMarketingWebhookSecret(),
    dbFrom,
    envFrom: envMarketingFrom(),
    transactionalFrom: transactional.mailFrom,
  });
}

async function getMarketingEmailAdminView() {
  const [row, transactional, marketing] = await Promise.all([
    loadDbRow(),
    getEmailSettings(),
    getResolvedMarketingEmailConfig(),
  ]);
  const storedFrom = row?.marketing_email_from ? String(row.marketing_email_from).trim() : '';
  return {
    marketingResendWebhookSecretConfigured: Boolean(marketing.webhookSecret),
    marketingResendWebhookSecretMasked: maskWebhookSecret(marketing.webhookSecret),
    marketingResendWebhookSecretSource: marketing.webhookSecretSource,
    marketingEmailFrom: storedFrom,
    effectiveMarketingEmailFrom: marketing.from,
    effectiveMarketingEmailFromSource: marketing.fromSource,
    marketingWebhookUrl: marketingWebhookUrl(),
    resendApiKeyConfigured: Boolean(transactional.resendApiKey),
    resendApiKeyMasked: transactional.resendApiKey
      ? (() => {
          const v = transactional.resendApiKey;
          if (v.length <= 10) return '••••••••';
          return `${v.slice(0, 6)}…${v.slice(-4)}`;
        })()
      : null,
    effectiveEmailSource: transactional.source,
  };
}

async function saveMarketingEmailSettings(actorEmail, body = {}) {
  const row = await loadDbRow();
  let marketingSecret = row?.marketing_resend_webhook_secret || null;
  let marketingFrom = row?.marketing_email_from || null;

  if (body.clearMarketingResendWebhookSecret) {
    marketingSecret = null;
  } else if (body.marketingResendWebhookSecret && String(body.marketingResendWebhookSecret).trim()) {
    const secret = String(body.marketingResendWebhookSecret).trim();
    if (!isValidResendWebhookSecret(secret)) {
      return { ok: false, error: 'Webhook signing secret must look like whsec_…' };
    }
    marketingSecret = encryptSecret(secret);
  } else if (marketingSecret && !isEncrypted(String(marketingSecret))) {
    marketingSecret = encryptSecret(String(marketingSecret));
  }

  if (body.marketingEmailFrom !== undefined) {
    const from = String(body.marketingEmailFrom || '').trim();
    if (from && !isValidFromAddress(from)) {
      return { ok: false, error: 'Marketing From address looks invalid' };
    }
    marketingFrom = from || null;
  }

  const now = new Date().toISOString();
  if (row) {
    await db.run(
      `UPDATE v2_platform_email_settings
       SET marketing_resend_webhook_secret = ?, marketing_email_from = ?,
           updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [marketingSecret, marketingFrom, now, actorEmail, SETTINGS_ID]
    );
  } else {
    await db.run(
      `INSERT INTO v2_platform_email_settings
       (id, email_enabled, resend_api_key, mail_from, resend_webhook_secret, ics_organizer_domain,
        marketing_resend_webhook_secret, marketing_email_from, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [SETTINGS_ID, 1, null, null, null, null, marketingSecret, marketingFrom, now, actorEmail]
    );
  }

  return { ok: true, settings: await getMarketingEmailAdminView() };
}

module.exports = {
  getResolvedMarketingEmailConfig,
  getMarketingEmailAdminView,
  saveMarketingEmailSettings,
};
