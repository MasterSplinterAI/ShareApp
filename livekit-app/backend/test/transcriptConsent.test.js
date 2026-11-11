process.env.JWT_SECRET_V2 = 'transcript-consent-test-secret-not-production';
process.env.V2_DB_PATH = ':memory:';
if (process.env.TRANSCRIPT_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TRANSCRIPT_TEST_DATABASE_URL;
} else {
  delete process.env.DATABASE_URL;
}

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../db/v2Database');
const { signSession } = require('../lib/authAdapter');
const livekit = require('../lib/livekitService');
livekit.createLiveKitConferenceRoom = async () => {};
require('../lib/mailer').sendEmail = async () => ({ sent: false, reason: 'test' });
const push = require('../lib/v2PushNotifications');
push.sendIncomingCallPush = async () => {};
push.sendContactAddedPush = async () => {};
const meetings = require('../routes/v2/meetings');
const calls = require('../routes/v2/calls');

describe('default-on transcript storage with host opt-out', () => {
  let server;
  let token;

  function request(method, path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port,
        path, method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  before(async () => {
    await db.initDatabase();
    await db.run(`INSERT INTO v2_users (id,email,password_hash) VALUES ('consent-host','host@example.com','unused')`);
    await db.run(`INSERT INTO v2_organizations (id,name,billing_status) VALUES ('consent-org','Consent','active')`);
    await db.run(`INSERT INTO v2_org_members (org_id,user_id,role) VALUES ('consent-org','consent-host','owner')`);
    await db.run(`INSERT INTO v2_org_subscriptions (org_id,plan_id,status) VALUES ('consent-org','free','active')`);
    token = signSession({ sub: 'consent-host', email: 'host@example.com', orgId: 'consent-org', role: 'owner' });
    const app = express();
    app.use(express.json());
    app.use('/meetings', meetings);
    app.use(calls);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

  it('saves new meeting transcripts by default', async () => {
    const res = await request('POST', '/meetings', { title: 'Default meeting' });
    assert.equal(res.status, 201);
    assert.equal(res.body.policy.store_transcripts, true);
    const policy = await db.get(`SELECT store_transcripts FROM v2_meeting_policies WHERE meeting_id=?`, [res.body.id]);
    assert.equal(policy.store_transcripts, 1);
  });

  it('retains explicit opt-in and allows the host to turn saving off', async () => {
    const res = await request('POST', '/meetings', { title: 'Saved meeting', store_transcripts: true });
    assert.equal(res.status, 201);
    assert.equal(res.body.policy.store_transcripts, true);
    assert.equal((await request('PATCH', `/meetings/${res.body.id}`, { title: 'Renamed' })).status, 200);
    assert.equal((await db.get(`SELECT store_transcripts FROM v2_meeting_policies WHERE meeting_id=?`, [res.body.id])).store_transcripts, 1);
    assert.equal((await request('PATCH', `/meetings/${res.body.id}`, { store_transcripts: 'false' })).status, 400);
    const patch = await request('PATCH', `/meetings/${res.body.id}`, { store_transcripts: false });
    assert.equal(patch.status, 200);
    const policy = await db.get(`SELECT store_transcripts FROM v2_meeting_policies WHERE meeting_id=?`, [res.body.id]);
    assert.equal(policy.store_transcripts, 0);
    const ingestion = await request('POST', `/meetings/${res.body.id}/transcript-lines`, { lines: [{ original_text: 'Must not be stored' }] });
    assert.equal(ingestion.status, 403);
    assert.equal(ingestion.body.code, 'transcripts_disabled');
  });

  it('rejects nonboolean transcript settings', async () => {
    for (const value of ['false', 'true', 1, null]) {
      assert.equal((await request('POST', '/meetings', { store_transcripts: value })).status, 400);
      assert.equal((await request('POST', '/calls/start', { email: 'guest@example.com', store_transcripts: value })).status, 400);
    }
  });

  it('preserves explicit opt-out on creation and unrelated updates', async () => {
    const res = await request('POST', '/meetings', { store_transcripts: false });
    assert.equal(res.status, 201);
    assert.equal(res.body.policy.store_transcripts, false);
    await request('PATCH', `/meetings/${res.body.id}`, { title: 'Still private' });
    assert.equal((await db.get('SELECT store_transcripts FROM v2_meeting_policies WHERE meeting_id=?', [res.body.id])).store_transcripts, 0);
  });

  it('saves new direct call transcripts by default', async () => {
    const res = await request('POST', '/calls/start', { email: 'guest@example.com', name: 'Guest' });
    assert.equal(res.status, 201);
    const policy = await db.get(`SELECT store_transcripts FROM v2_meeting_policies WHERE meeting_id=?`, [res.body.meeting.id]);
    assert.equal(policy.store_transcripts, 1);
  });

  it('honors explicit host opt-out for a new direct call', async () => {
    const res = await request('POST', '/calls/start', { email: 'guest@example.com', store_transcripts: false });
    assert.equal(res.status, 201);
    const policy = await db.get(`SELECT store_transcripts FROM v2_meeting_policies WHERE meeting_id=?`, [res.body.meeting.id]);
    assert.equal(policy.store_transcripts, 0);
  });
});
