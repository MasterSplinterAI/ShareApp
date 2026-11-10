const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveMarketingEmailConfig,
  marketingWebhookUrl,
  isValidResendWebhookSecret,
  isValidFromAddress,
  MARKETING_RESEND_WEBHOOK_PATH,
} = require('../lib/marketingEmailSettings');

describe('marketingEmailSettings', () => {
  it('resolves webhook secret with db overriding env', () => {
    const both = resolveMarketingEmailConfig({
      dbSecret: 'whsec_db',
      envSecret: 'whsec_env',
      transactionalFrom: 'Lalia <no-reply@lalia.cloud>',
    });
    assert.equal(both.webhookSecret, 'whsec_db');
    assert.equal(both.webhookSecretSource, 'db');

    const envOnly = resolveMarketingEmailConfig({
      dbSecret: '  ',
      envSecret: 'whsec_env',
      transactionalFrom: 'x@y.z',
    });
    assert.equal(envOnly.webhookSecret, 'whsec_env');
    assert.equal(envOnly.webhookSecretSource, 'env');

    const none = resolveMarketingEmailConfig({ transactionalFrom: 'x@y.z' });
    assert.equal(none.webhookSecret, null);
    assert.equal(none.webhookSecretSource, 'none');
  });

  it('resolves from address marketing_db > marketing_env > transactional', () => {
    const cfg = resolveMarketingEmailConfig({
      dbFrom: 'Lalia Journal <hello@lalia.cloud>',
      envFrom: 'Env <env@lalia.cloud>',
      transactionalFrom: 'Lalia <no-reply@lalia.cloud>',
    });
    assert.equal(cfg.from, 'Lalia Journal <hello@lalia.cloud>');
    assert.equal(cfg.fromSource, 'marketing_db');

    const env = resolveMarketingEmailConfig({
      envFrom: 'Env <env@lalia.cloud>',
      transactionalFrom: 'Lalia <no-reply@lalia.cloud>',
    });
    assert.equal(env.fromSource, 'marketing_env');

    const tx = resolveMarketingEmailConfig({
      transactionalFrom: 'Lalia <no-reply@lalia.cloud>',
    });
    assert.equal(tx.from, 'Lalia <no-reply@lalia.cloud>');
    assert.equal(tx.fromSource, 'transactional');
  });

  it('builds the public Resend webhook URL', () => {
    assert.equal(
      marketingWebhookUrl('https://lalia.cloud'),
      `https://lalia.cloud${MARKETING_RESEND_WEBHOOK_PATH}`
    );
    assert.equal(MARKETING_RESEND_WEBHOOK_PATH, '/marketing/webhooks/resend');
  });

  it('validates whsec_ secrets and from addresses', () => {
    assert.equal(isValidResendWebhookSecret('whsec_abcdefghijklmnopqrstuv'), true);
    assert.equal(isValidResendWebhookSecret('re_not_a_webhook'), false);
    assert.equal(isValidFromAddress('Lalia <hello@lalia.cloud>'), true);
    assert.equal(isValidFromAddress('hello@lalia.cloud'), true);
    assert.equal(isValidFromAddress('not-an-email'), false);
  });
});
