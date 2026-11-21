const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
let metadata = {};
try { metadata = require('./recovery-metadata.cjs'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const key = 'synthetic-recovery-key';
const reference = () => ({ format: 1, backend: { secretArn: 'arn:aws:secretsmanager:us-east-2:690248313257:secret:lalia/prod/recovery/backend-Ab123X', versionId: '12345678-1234-1234-1234-123456789012', keyGeneration: 'key-generation-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 24) } });
test('recovery metadata permits only exact nonsecret backend references', () => {
  assert.equal(typeof metadata.validateRecoveryMetadata, 'function');
  assert.deepEqual(metadata.validateRecoveryMetadata(reference()), reference());
  for (const change of [r => { r.secret = 'PRIVATE'; }, r => { r.backend.SETTINGS_ENCRYPTION_KEY = 'PRIVATE'; }, r => { r.backend.secretArn = r.backend.secretArn.replace('backend-', 'agent-primary-'); }, r => { r.backend.versionId = '*'; }, r => { r.backend.keyGeneration = 'PRIVATE'; }, r => { r.format = 2; }]) {
    const value = reference(); change(value); assert.throws(() => metadata.validateRecoveryMetadata(value), error => !error.message.includes('PRIVATE'));
  }
});
test('backup reference must match the current settings key generation', () => {
  assert.equal(typeof metadata.assertRecoveryGeneration, 'function');
  assert.doesNotThrow(() => metadata.assertRecoveryGeneration(reference(), ` ${key} `));
  assert.throws(() => metadata.assertRecoveryGeneration(reference(), 'wrong-synthetic-key'), /generation/);
  assert.throws(() => metadata.assertRecoveryGeneration(reference(), ''), /generation/);
});
