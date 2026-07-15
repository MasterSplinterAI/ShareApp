const db = require('../db/v2Database');
const { encryptSecret, decryptSecret, isEncrypted } = require('./secretCrypto');

const SETTINGS_ID = 'default';
let cache = null;
let cacheAt = 0;
const CACHE_MS = 3000;

function decryptField(raw) {
  if (!raw) return null;
  try {
    return decryptSecret(String(raw).trim());
  } catch (e) {
    console.warn('[v2StripeSettings] decrypt failed:', e.message);
    return null;
  }
}

async function migratePlaintextSecrets(row) {
  if (!row) return row;
  let secret = row.stripe_secret_key ? String(row.stripe_secret_key).trim() : null;
  let webhook = row.stripe_webhook_secret ? String(row.stripe_webhook_secret).trim() : null;
  let changed = false;
  if (secret && !isEncrypted(secret) && /^sk_(test|live)_/.test(secret)) {
    secret = encryptSecret(secret);
    changed = true;
  }
  if (webhook && !isEncrypted(webhook) && webhook.startsWith('whsec_')) {
    webhook = encryptSecret(webhook);
    changed = true;
  }
  if (changed) {
    await db.run(
      `UPDATE v2_platform_billing_settings SET stripe_secret_key = ?, stripe_webhook_secret = ? WHERE id = ?`,
      [secret, webhook, SETTINGS_ID]
    );
    row = { ...row, stripe_secret_key: secret, stripe_webhook_secret: webhook };
  }
  return row;
}

function maskStripeSecret(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 12) return '••••••••';
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}

function stripeKeyModeFromKey(key) {
  if (!key) return 'unset';
  if (key.startsWith('sk_live_')) return 'live';
  if (key.startsWith('sk_test_')) return 'test';
  return 'unknown';
}

function envStripeEnabled() {
  return process.env.STRIPE_ENABLED === 'true';
}

function envSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key && String(key).trim() ? String(key).trim() : null;
}

function envWebhookSecret() {
  const key = process.env.STRIPE_WEBHOOK_SECRET;
  return key && String(key).trim() ? String(key).trim() : null;
}

function envAutoChargeEnabled() {
  return process.env.V2_AUTO_CHARGE_ENABLED === 'true';
}

async function loadDbRow() {
  return db.get(`SELECT * FROM v2_platform_billing_settings WHERE id = ?`, [SETTINGS_ID]);
}

function mergeSettings(row) {
  const dbEnabled = row ? Boolean(row.stripe_enabled) : null;
  const dbAutoCharge = row ? Boolean(row.auto_charge_enabled) : null;
  const dbSecretRaw = row?.stripe_secret_key ? String(row.stripe_secret_key).trim() : null;
  const dbWebhookRaw = row?.stripe_webhook_secret ? String(row.stripe_webhook_secret).trim() : null;
  const dbSecret = decryptField(dbSecretRaw);
  const dbWebhook = decryptField(dbWebhookRaw);

  const secretKey = dbSecret || envSecretKey();
  const webhookSecret = dbWebhook || envWebhookSecret();
  const stripeEnabled =
    dbEnabled !== null ? dbEnabled && Boolean(secretKey) : envStripeEnabled() && Boolean(secretKey);
  const autoChargeEnabled = dbAutoCharge !== null ? dbAutoCharge : envAutoChargeEnabled();

  let source = 'environment';
  if (row) {
    source = dbSecret || dbWebhook || dbEnabled !== null || dbAutoCharge !== null ? 'database' : 'environment';
    if ((dbSecret || dbWebhook) && (envSecretKey() || envWebhookSecret())) source = 'mixed';
  }

  return {
    stripeEnabled,
    autoChargeEnabled,
    secretKey,
    webhookSecret,
    stripeKeyMode: stripeKeyModeFromKey(secretKey),
    source,
    dbRow: row,
    hasDbSecret: Boolean(dbSecret),
    hasDbWebhook: Boolean(dbWebhook),
    hasEnvSecret: Boolean(envSecretKey()),
    hasEnvWebhook: Boolean(envWebhookSecret()),
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

async function getStripeSettings({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache && now - cacheAt < CACHE_MS) return cache;
  let row = await loadDbRow();
  row = await migratePlaintextSecrets(row);
  cache = mergeSettings(row);
  cacheAt = now;
  return cache;
}

function invalidateStripeSettingsCache() {
  cache = null;
  cacheAt = 0;
}

function isStripeBillingActive(settings) {
  return Boolean(settings?.stripeEnabled && settings?.secretKey);
}

function getStripeClient(settings) {
  if (!isStripeBillingActive(settings)) return null;
  // eslint-disable-next-line global-require
  const Stripe = require('stripe');
  return new Stripe(settings.secretKey);
}

function validateSecretKey(key) {
  if (!key) return null;
  const trimmed = String(key).trim();
  if (!/^sk_(test|live)_/.test(trimmed)) {
    return 'Stripe secret key must start with sk_test_ or sk_live_';
  }
  return null;
}

function validateWebhookSecret(key) {
  if (!key) return null;
  const trimmed = String(key).trim();
  if (!trimmed.startsWith('whsec_')) {
    return 'Webhook secret must start with whsec_';
  }
  return null;
}

async function saveStripeSettings(actorEmail, body = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 4) {
    return { ok: false, error: 'reason required (4+ chars)' };
  }

  const row = await loadDbRow();
  const next = {
    stripe_enabled: row ? Boolean(row.stripe_enabled) : false,
    stripe_secret_key: row?.stripe_secret_key || null,
    stripe_webhook_secret: row?.stripe_webhook_secret || null,
    auto_charge_enabled: row ? Boolean(row.auto_charge_enabled) : false,
  };

  if (body.stripeEnabled !== undefined) {
    next.stripe_enabled = Boolean(body.stripeEnabled);
  }
  if (body.autoChargeEnabled !== undefined) {
    next.auto_charge_enabled = Boolean(body.autoChargeEnabled);
  }

  if (body.clearStripeSecretKey) {
    next.stripe_secret_key = null;
  } else if (body.stripeSecretKey !== undefined && body.stripeSecretKey !== '') {
    const err = validateSecretKey(body.stripeSecretKey);
    if (err) return { ok: false, error: err };
    next.stripe_secret_key = encryptSecret(String(body.stripeSecretKey).trim());
  } else if (next.stripe_secret_key && !isEncrypted(next.stripe_secret_key)) {
    next.stripe_secret_key = encryptSecret(next.stripe_secret_key);
  }

  if (body.clearWebhookSecret) {
    next.stripe_webhook_secret = null;
  } else if (body.stripeWebhookSecret !== undefined && body.stripeWebhookSecret !== '') {
    const err = validateWebhookSecret(body.stripeWebhookSecret);
    if (err) return { ok: false, error: err };
    next.stripe_webhook_secret = encryptSecret(String(body.stripeWebhookSecret).trim());
  } else if (next.stripe_webhook_secret && !isEncrypted(next.stripe_webhook_secret)) {
    next.stripe_webhook_secret = encryptSecret(next.stripe_webhook_secret);
  }

  const mergedPreview = mergeSettings({
    stripe_enabled: next.stripe_enabled ? 1 : 0,
    auto_charge_enabled: next.auto_charge_enabled ? 1 : 0,
    stripe_secret_key: next.stripe_secret_key,
    stripe_webhook_secret: next.stripe_webhook_secret,
    updated_at: row?.updated_at,
    updated_by: row?.updated_by,
  });

  if (next.stripe_enabled && !mergedPreview.secretKey) {
    return { ok: false, error: 'Enter a Stripe secret key before enabling payments' };
  }

  const now = new Date().toISOString();
  if (row) {
    await db.run(
      `UPDATE v2_platform_billing_settings
       SET stripe_enabled = ?, stripe_secret_key = ?, stripe_webhook_secret = ?,
           auto_charge_enabled = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [
        next.stripe_enabled ? 1 : 0,
        next.stripe_secret_key,
        next.stripe_webhook_secret,
        next.auto_charge_enabled ? 1 : 0,
        now,
        actorEmail,
        SETTINGS_ID,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO v2_platform_billing_settings
       (id, stripe_enabled, stripe_secret_key, stripe_webhook_secret, auto_charge_enabled, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?)`,
      [
        SETTINGS_ID,
        next.stripe_enabled ? 1 : 0,
        next.stripe_secret_key,
        next.stripe_webhook_secret,
        next.auto_charge_enabled ? 1 : 0,
        now,
        actorEmail,
      ]
    );
  }

  invalidateStripeSettingsCache();
  const settings = await getStripeSettings({ fresh: true });
  return { ok: true, settings, reason };
}

function toAdminView(settings) {
  const row = settings.dbRow;
  return {
    stripeEnabled: settings.stripeEnabled,
    stripeEnabledPreference: row ? Boolean(row.stripe_enabled) : envStripeEnabled(),
    autoChargeEnabled: settings.autoChargeEnabled,
    autoChargePreference: row ? Boolean(row.auto_charge_enabled) : envAutoChargeEnabled(),
    stripeKeyMode: settings.stripeKeyMode,
    source: settings.source,
    hasStripeSecretKey: Boolean(settings.secretKey),
    hasWebhookSecret: Boolean(settings.webhookSecret),
    stripeSecretKeyMasked: maskStripeSecret(settings.secretKey),
    stripeWebhookSecretMasked: maskStripeSecret(settings.webhookSecret),
    usingEnvSecret: settings.hasEnvSecret && !settings.hasDbSecret,
    usingEnvWebhook: settings.hasEnvWebhook && !settings.hasDbWebhook,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

module.exports = {
  getStripeSettings,
  saveStripeSettings,
  invalidateStripeSettingsCache,
  isStripeBillingActive,
  getStripeClient,
  stripeKeyModeFromKey,
  maskStripeSecret,
  toAdminView,
};
