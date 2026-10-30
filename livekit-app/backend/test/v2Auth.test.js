process.env.JWT_SECRET_V2 = process.env.JWT_SECRET_V2 || 'test-secret-with-more-than-32-characters';
process.env.V2_DB_PATH = process.env.V2_DB_PATH || ':memory:';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/v2Database');
const { signSession } = require('../lib/authAdapter');
const { requireV2Auth } = require('../middleware/v2Auth');

describe('requireV2Auth', () => {
  before(async () => {
    await db.initDatabase();
    await db.run(
      `INSERT OR REPLACE INTO v2_users (id, email, password_hash, display_name)
       VALUES (?,?,?,?)`,
      ['user-auth-test', 'auth-test@example.com', 'unused', 'Auth Test']
    );
    await db.run(
      `INSERT OR REPLACE INTO v2_organizations (id, name, billing_status)
       VALUES (?,?,?)`,
      ['org-auth-test', 'Auth Test Org', 'active']
    );
    await db.run(
      `INSERT OR REPLACE INTO v2_org_members (org_id, user_id, role)
       VALUES (?,?,?)`,
      ['org-auth-test', 'user-auth-test', 'admin']
    );
  });

  it('attaches the fresh database role for a valid token', async () => {
    const token = signSession({
      sub: 'user-auth-test',
      email: 'auth-test@example.com',
      orgId: 'org-auth-test',
      role: 'member',
    });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    let nextCalled = false;

    await requireV2Auth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(req.v2Auth.role, 'admin');
  });
});
