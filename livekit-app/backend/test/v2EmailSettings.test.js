const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  maskWebhookSecret,
  validateResendWebhookSecret,
  validateIcsOrganizerDomain,
  extractDomainFromMailFrom,
} = require('../lib/v2EmailSettings');

test('maskWebhookSecret hides the middle of the secret', () => {
  const masked = maskWebhookSecret('whsec_abcdefghijklmnopqrstuvwxyz');
  assert.match(masked, /^whsec_ab…/);
  assert.ok(!masked.includes('klmnopqrst'));
});

test('maskWebhookSecret returns null for empty input', () => {
  assert.equal(maskWebhookSecret(''), null);
  assert.equal(maskWebhookSecret(null), null);
});

test('maskWebhookSecret fully masks very short values', () => {
  assert.equal(maskWebhookSecret('short'), '••••••••');
});

test('validateResendWebhookSecret accepts a well-formed whsec_ secret', () => {
  assert.equal(validateResendWebhookSecret('whsec_abcdefghijklmnop1234'), null);
});

test('validateResendWebhookSecret rejects wrong prefix', () => {
  assert.match(
    validateResendWebhookSecret('re_abcdefghijklmnop1234'),
    /must start with whsec_/
  );
});

test('validateResendWebhookSecret rejects too-short secret', () => {
  assert.match(validateResendWebhookSecret('whsec_short'), /too short/);
});

test('validateIcsOrganizerDomain accepts a bare domain', () => {
  assert.equal(validateIcsOrganizerDomain('meetings.jarmetals.com'), null);
});

test('validateIcsOrganizerDomain rejects a full email or URL', () => {
  assert.ok(validateIcsOrganizerDomain('https://example.com'));
  assert.ok(validateIcsOrganizerDomain('user@example.com'));
});

test('extractDomainFromMailFrom parses display-name addresses', () => {
  assert.equal(extractDomainFromMailFrom('Parley <no-reply@example.com>'), 'example.com');
  assert.equal(extractDomainFromMailFrom('no-reply@example.com'), 'example.com');
  assert.equal(extractDomainFromMailFrom(''), '');
});
