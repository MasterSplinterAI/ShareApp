process.env.JWT_SECRET_V2 = process.env.JWT_SECRET_V2 || 'test-secret-with-more-than-32-characters';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { encryptSecret, decryptSecret, isEncrypted, maskSecret } = require('../lib/secretCrypto');
const { LocalDriver, objectKey, createDriverFromConfig } = require('../lib/objectStorage');
const { mergeSettings } = require('../lib/v2StorageSettings');

describe('secretCrypto', () => {
  it('round-trips AES-GCM ciphertext', () => {
    const plain = 'super-secret-access-key';
    const enc = encryptSecret(plain);
    assert.ok(isEncrypted(enc));
    assert.equal(decryptSecret(enc), plain);
  });

  it('masks secrets for admin view', () => {
    assert.equal(maskSecret('abcdefghijklmnop'), '••••••••mnop');
  });
});

describe('objectKey', () => {
  it('keeps org isolation', () => {
    assert.equal(objectKey('org-1', 'branding/logo.png'), 'v2/org-1/branding/logo.png');
    assert.equal(objectKey('../evil', 'x'), 'v2/evil/x');
  });
});

describe('LocalDriver', () => {
  it('put/get/exists/delete under root', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'shareapp-storage-'));
    const driver = new LocalDriver(root);
    const key = objectKey('orgA', 'branding/logo.png');
    await driver.put(key, Buffer.from('png-bytes'), { contentType: 'image/png' });
    assert.equal(await driver.exists(key), true);
    const bytes = await driver.getBytes(key);
    assert.equal(bytes.toString(), 'png-bytes');
    assert.equal(await driver.delete(key), true);
    assert.equal(await driver.exists(key), false);
    await fsp.rm(root, { recursive: true, force: true });
  });
});

describe('mergeSettings', () => {
  it('defaults to local from env', () => {
    const prev = process.env.STORAGE_DRIVER;
    delete process.env.STORAGE_DRIVER;
    const s = mergeSettings(null);
    assert.equal(s.driver, 'local');
    if (prev !== undefined) process.env.STORAGE_DRIVER = prev;
  });

  it('DB driver overrides env', () => {
    process.env.STORAGE_DRIVER = 'local';
    const s = mergeSettings({
      storage_driver: 's3',
      storage_s3_bucket: 'demo',
      storage_s3_region: 'auto',
      storage_s3_endpoint: 'https://example.r2.cloudflarestorage.com',
      storage_s3_force_path_style: null,
      storage_s3_access_key_id: 'AKIA',
      storage_s3_secret_access_key: null,
      storage_s3_prefix: 'prod',
      updated_at: null,
      updated_by: null,
    });
    assert.equal(s.driver, 's3');
    assert.equal(s.bucket, 'demo');
    assert.equal(s.forcePathStyle, true);
    delete process.env.STORAGE_DRIVER;
  });

  it('createDriverFromConfig builds local driver', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shareapp-cfg-'));
    const driver = createDriverFromConfig({
      driver: 'local',
      localDir: root,
    });
    assert.ok(driver instanceof LocalDriver);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
