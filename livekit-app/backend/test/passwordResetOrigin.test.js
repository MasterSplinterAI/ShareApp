process.env.DATABASE_URL = '';
process.env.V2_DB_PATH = ':memory:';
const { before, beforeEach, test, mock } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/v2Database');
const sent = [];
mock.method(require('../lib/mailer'), 'sendEmail', async (email) => { sent.push(email); return { sent: true }; });
const { sendPasswordResetEmail } = require('../lib/passwordReset');

before(async () => {
  await db.initDatabase();
  await db.run('INSERT INTO v2_users (id, email, password_hash) VALUES (?,?,?)', ['reset-user', 'reset@example.test', 'unused']);
});
beforeEach(() => {
  sent.length = 0;
  for (const key of ['PUBLIC_FRONTEND_BASE_URL', 'FRONTEND_URL', 'PRODUCTION_URL', 'STAGING_FRONTEND_URL']) delete process.env[key];
});

async function resetUrl() {
  await sendPasswordResetEmail({ headers: { origin: 'https://attacker.example', referer: 'https://attacker.example/reset' } }, 'reset-user');
  assert.equal(sent.length, 1);
  const match = sent[0].text.match(/https?:\/\/[^\s<>]+\/v2\/reset-password\?token=[a-f0-9]+/);
  assert.ok(match, sent[0].text);
  return new URL(match[0]);
}

test('reset emails ignore request origins and use the canonical public default', async () => {
  assert.equal((await resetUrl()).origin, 'https://lalia.cloud');
});
test('configured frontend origin is used without trusting request headers', async () => {
  process.env.FRONTEND_URL = 'https://staging.example.test';
  assert.equal((await resetUrl()).origin, 'https://staging.example.test');
});
test('explicit canonical public URL takes precedence and is normalized to an origin', async () => {
  process.env.PUBLIC_FRONTEND_BASE_URL = 'https://lalia.cloud/ignored-path?ignored=1';
  process.env.FRONTEND_URL = 'https://staging.example.test';
  const url = await resetUrl();
  assert.equal(url.origin, 'https://lalia.cloud');
  assert.equal(url.pathname, '/v2/reset-password');
});
test('unsafe configured protocols fail before sending reset email', async () => {
  process.env.PUBLIC_FRONTEND_BASE_URL = 'javascript:alert(1)';
  await assert.rejects(() => sendPasswordResetEmail({ headers: {} }, 'reset-user'), /frontend.*URL/i);
  assert.equal(sent.length, 0);
});
