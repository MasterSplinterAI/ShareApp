const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const { publicFrontendBaseUrl } = require('../lib/publicFrontendBaseUrl');

const envKeys = ['NODE_ENV', 'PUBLIC_FRONTEND_BASE_URL', 'FRONTEND_URL', 'PRODUCTION_URL', 'STAGING_FRONTEND_URL'];
const saved = {};
beforeEach(() => {
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('production links use the configured canonical origin for native, browser and scheduled jobs', () => {
  process.env.NODE_ENV = 'production';
  process.env.PUBLIC_FRONTEND_BASE_URL = 'https://lalia.cloud/path?old=1';
  process.env.FRONTEND_URL = 'https://www.lalia.cloud';
  assert.equal(publicFrontendBaseUrl({ headers: {} }), 'https://lalia.cloud');
  assert.equal(publicFrontendBaseUrl({ headers: { origin: 'capacitor://localhost' } }), 'https://lalia.cloud');
  assert.equal(publicFrontendBaseUrl({ headers: { origin: 'https://untrusted.example', referer: 'https://untrusted.example/path' } }), 'https://lalia.cloud');
  assert.equal(publicFrontendBaseUrl(), 'https://lalia.cloud');
});

test('production links reject unsupported and credential-bearing origins', () => {
  process.env.NODE_ENV = 'production';
  process.env.PUBLIC_FRONTEND_BASE_URL = 'ftp://files.example.test';
  process.env.FRONTEND_URL = 'https://user:password@host.example.test';
  process.env.PRODUCTION_URL = 'example.test';
  assert.equal(publicFrontendBaseUrl({ headers: { origin: 'https://untrusted.example' } }), 'https://example.test');
});

test('development links retain local browser origins and strip Referer paths', () => {
  process.env.NODE_ENV = 'development';
  process.env.PUBLIC_FRONTEND_BASE_URL = 'https://lalia.cloud';
  assert.equal(publicFrontendBaseUrl({ headers: { origin: 'http://127.0.0.1:5174' } }), 'http://127.0.0.1:5174');
  assert.equal(publicFrontendBaseUrl({ headers: { referer: 'http://localhost:5174/v2/app/meetings' } }), 'http://localhost:5174');
});

test('unconfigured production uses the public Lalia origin', () => {
  process.env.NODE_ENV = 'production';
  assert.equal(publicFrontendBaseUrl({ headers: { origin: 'https://untrusted.example' } }), 'https://lalia.cloud');
});
