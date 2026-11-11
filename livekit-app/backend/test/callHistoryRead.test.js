process.env.JWT_SECRET_V2 = 'call-history-test-secret-not-for-production';
process.env.V2_DB_PATH = ':memory:';
if (process.env.CALL_HISTORY_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.CALL_HISTORY_TEST_DATABASE_URL;
} else {
  delete process.env.DATABASE_URL;
}

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../db/v2Database');
const { signSession } = require('../lib/authAdapter');
const callsRouter = require('../routes/v2/calls');

describe('viewed missed calls', () => {
  let server;
  const tokens = {};
  let sequence = 0;

  function request(method, path, body, user = 'recipient') {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path, method,
        headers: {
          'Content-Type': 'application/json',
          ...(user ? { Authorization: `Bearer ${tokens[user]}` } : {}),
        },
      }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          let data;
          try { data = JSON.parse(text); } catch { data = text; }
          resolve({ status: res.statusCode, data });
        });
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  async function seedCall({ status = 'missed', caller = 'caller', callee = 'recipient', emailOnly = false } = {}) {
    const id = `read-call-${++sequence}`;
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO v2_direct_calls
       (id, caller_user_id, caller_name, caller_email, callee_user_id, callee_email,
        meeting_id, room_name, join_url, status, created_at, updated_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, caller, caller, `${caller}@example.com`, emailOnly ? null : callee,
        `${callee.toUpperCase()}@EXAMPLE.COM`, 'read-meeting', 'read-room', '/join/read-room',
        status, now, now, new Date(Date.now() + 60000).toISOString()]
    );
    return id;
  }

  async function history(user = 'recipient') {
    const res = await request('GET', '/calls/history', undefined, user);
    assert.equal(res.status, 200);
    return res.data.calls;
  }

  before(async () => {
    await db.initDatabase();
    await db.run(`INSERT INTO v2_organizations (id, name, billing_status) VALUES ('read-org', 'Read tests', 'active')`);
    for (const id of ['caller', 'recipient', 'other']) {
      await db.run(`INSERT INTO v2_users (id, email, password_hash) VALUES (?,?,?)`, [id, `${id}@example.com`, 'unused']);
      await db.run(`INSERT INTO v2_org_members (org_id, user_id, role) VALUES ('read-org', ?, 'owner')`, [id]);
      tokens[id] = signSession({ sub: id, email: `${id}@example.com`, orgId: 'read-org', role: 'owner' });
    }
    await db.run(`INSERT INTO v2_meetings (id, org_id, host_user_id, livekit_room_name, host_code)
                  VALUES ('read-meeting', 'read-org', 'caller', 'read-room', 'TEST')`);
    const app = express();
    app.use(express.json());
    app.use(callsRouter);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('fetching history for the home banner does not mark missed calls as read', async () => {
    const id = await seedCall();
    assert.equal((await history()).find((c) => c.id === id).readAt, null);
    assert.equal((await history()).find((c) => c.id === id).readAt, null);
  });

  it('persists acknowledgement without deleting calls or changing their missed status', async () => {
    const id = await seedCall();
    const res = await request('POST', '/calls/history/read', { callIds: [id] });
    assert.equal(res.status, 200);
    const viewed = (await history()).find((c) => c.id === id);
    assert.equal(viewed.status, 'missed');
    assert.ok(viewed.readAt);
    assert.equal((await request('POST', '/calls/history/read', { callIds: [id, id] })).status, 200);
    assert.equal((await history()).find((c) => c.id === id).readAt, viewed.readAt);
  });

  it('acknowledges canceled incoming calls matched by email', async () => {
    const id = await seedCall({ status: 'canceled', emailOnly: true });
    assert.equal((await request('POST', '/calls/history/read', { callIds: [id] })).status, 200);
    assert.ok((await history()).find((c) => c.id === id).readAt);
  });

  it('does not acknowledge other users, outgoing calls, or calls still ringing', async () => {
    const other = await seedCall({ callee: 'other' });
    const outgoing = await seedCall({ caller: 'recipient', callee: 'other' });
    const ringing = await seedCall({ status: 'ringing' });
    const res = await request('POST', '/calls/history/read', { callIds: [other, outgoing, ringing, 'nonexistent'] });
    assert.equal(res.status, 200);
    const rows = await db.all(`SELECT * FROM v2_call_history_reads WHERE call_id IN (?,?,?)`, [other, outgoing, ringing]);
    assert.equal(rows.length, 0);
    // A call that becomes missed after the log was viewed must still alert.
    await db.run(`UPDATE v2_direct_calls SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`, [ringing]);
    const missed = (await history()).find((c) => c.id === ringing);
    assert.equal(missed.status, 'missed');
    assert.equal(missed.readAt, null);
  });

  it('only marks the displayed IDs, leaving newer missed calls unread', async () => {
    const displayed = await seedCall();
    const later = await seedCall();
    assert.equal((await request('POST', '/calls/history/read', { callIds: [displayed] })).status, 200);
    assert.equal((await history()).find((c) => c.id === later).readAt, null);
  });

  it('requires authentication and validates bounded call ID lists', async () => {
    assert.equal((await request('POST', '/calls/history/read', { callIds: ['x'] }, null)).status, 401);
    for (const body of [{}, { callIds: 'all' }, { callIds: [null] }, { callIds: [''] }, { callIds: Array(31).fill('x') }]) {
      assert.equal((await request('POST', '/calls/history/read', body)).status, 400);
    }
    assert.equal((await request('POST', '/calls/history/read', { callIds: [] })).status, 200);
  });
});
