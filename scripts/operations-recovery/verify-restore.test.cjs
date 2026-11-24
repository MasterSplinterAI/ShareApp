const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
let verify = {};
try { verify = require('./verify-restore.cjs'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
function encrypt(key, value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(key).digest(), iv); const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${bytes.toString('base64')}`; }
test('recovered settings key authenticates ciphertext without returning plaintext', () => {
  assert.equal(typeof verify.verifyEncryptedValue, 'function');
  const ciphertext = encrypt('synthetic-key', 'PRIVATE-PLAINTEXT-SENTINEL');
  assert.equal(verify.verifyEncryptedValue(ciphertext, ' synthetic-key '), true);
  assert.throws(() => verify.verifyEncryptedValue(ciphertext, 'wrong-key'), error => !error.message.includes('PRIVATE') && /verification failed/.test(error.message));
  for (const invalid of ['plain', 'enc:v1:bad', 'enc:v1:AA==:AA==:AA==']) assert.throws(() => verify.verifyEncryptedValue(invalid, 'synthetic-key'));
});
test('restore settings scan checks only encrypted values and fails empty coverage', async () => {
  assert.equal(typeof verify.verifyStoredSettings, 'function');
  const ciphertext = encrypt('synthetic-key', 'PRIVATE'); let queries = 0;
  const client = { query: async () => { queries++; return queries === 1 ? { rows: [{ table_name: 'v2_platform_email_settings', column_name: 'resend_api_key' }] } : { rows: [{ value: ciphertext }] }; } };
  assert.deepEqual(await verify.verifyStoredSettings(client, 'synthetic-key'), { encryptedValues: 1, authenticatedValues: 1, allAuthenticated: true });
  await assert.rejects(verify.verifyStoredSettings({ query: async () => ({ rows: [] }) }, 'synthetic-key'), /No encrypted settings/);
});
