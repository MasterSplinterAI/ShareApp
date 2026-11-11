/**
 * Marketing email config (@rhule/marketing-kit).
 * DB overrides env; From finally falls back to transactional mail_from.
 */

const MARKETING_RESEND_WEBHOOK_PATH = '/marketing/webhooks/resend';

function isValidResendWebhookSecret(secret) {
  return /^whsec_[A-Za-z0-9+/=]{16,}$/.test(String(secret || '').trim());
}

function isValidFromAddress(from) {
  return /^([^<>]*<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(String(from || '').trim());
}

function resolveMarketingEmailConfig(input) {
  const dbSecret = input.dbSecret?.trim() || null;
  const envSecret = input.envSecret?.trim() || null;
  const dbFrom = input.dbFrom?.trim() || null;
  const envFrom = input.envFrom?.trim() || null;
  return {
    webhookSecret: dbSecret || envSecret,
    webhookSecretSource: dbSecret ? 'db' : envSecret ? 'env' : 'none',
    from: dbFrom || envFrom || input.transactionalFrom,
    fromSource: dbFrom ? 'marketing_db' : envFrom ? 'marketing_env' : 'transactional',
  };
}

function marketingWebhookUrl(appUrl) {
  const origin = String(appUrl || process.env.PUBLIC_FRONTEND_BASE_URL || process.env.FRONTEND_URL || 'https://lalia.cloud')
    .trim()
    .replace(/\/$/, '');
  return `${origin}${MARKETING_RESEND_WEBHOOK_PATH}`;
}

function maskWebhookSecret(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 12) return '••••••••';
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

module.exports = {
  MARKETING_RESEND_WEBHOOK_PATH,
  isValidResendWebhookSecret,
  isValidFromAddress,
  resolveMarketingEmailConfig,
  marketingWebhookUrl,
  maskWebhookSecret,
};
