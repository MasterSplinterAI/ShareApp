process.env.JWT_SECRET_V2 = process.env.JWT_SECRET_V2 || 'test-secret-with-more-than-32-characters';
process.env.V2_DB_PATH = ':memory:';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../db/v2Database');
const { signSession } = require('../lib/authAdapter');
const authRouter = require('../routes/v2/auth');

function requestJson(server, method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const payload = body ? JSON.stringify(body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('preferred language on /auth/me', () => {
  let server;
  let token;

  before(async () => {
    await db.initDatabase();
    await require('../lib/opsOutbox').ensureOpsOutboxSchema();
    await db.run(
      `INSERT OR REPLACE INTO v2_users (id, email, password_hash, display_name)
       VALUES (?,?,?,?)`,
      ['user-lang-pref', 'lang-pref@example.com', 'unused', 'Lang Pref']
    );
    await db.run(
      `INSERT OR REPLACE INTO v2_organizations (id, name, billing_status)
       VALUES (?,?,?)`,
      ['org-lang-pref', 'Lang Pref Org', 'active']
    );
    await db.run(
      `INSERT OR REPLACE INTO v2_org_members (org_id, user_id, role)
       VALUES (?,?,?)`,
      ['org-lang-pref', 'user-lang-pref', 'admin']
    );
    token = signSession({
      sub: 'user-lang-pref',
      email: 'lang-pref@example.com',
      orgId: 'org-lang-pref',
      role: 'admin',
    });
    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('returns null preferred_language by default and accepts preferredLanguage patches', async () => {
    const get1 = await requestJson(server, 'GET', '/auth/me', null, token);
    assert.equal(get1.status, 200);
    assert.equal(get1.body.user.preferred_language, null);
    assert.equal(get1.body.user.preferredLanguage, null);

    const patch = await requestJson(
      server,
      'PATCH',
      '/auth/me',
      { preferredLanguage: 'es-MX' },
      token
    );
    assert.equal(patch.status, 200);
    assert.equal(patch.body.user.preferred_language, 'es-MX');
    assert.equal(patch.body.user.preferredLanguage, 'es-MX');

    const get2 = await requestJson(server, 'GET', '/auth/me', null, token);
    assert.equal(get2.status, 200);
    assert.equal(get2.body.user.preferredLanguage, 'es-MX');
  });

  it('rejects invalid preferredLanguage codes', async () => {
    const bad = await requestJson(
      server,
      'PATCH',
      '/auth/me',
      { preferredLanguage: 'not a lang!!!' },
      token
    );
    assert.equal(bad.status, 400);
  });
});
