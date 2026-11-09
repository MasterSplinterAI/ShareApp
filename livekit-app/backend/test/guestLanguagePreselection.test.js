process.env.JWT_SECRET_V2 = process.env.JWT_SECRET_V2 || 'test-secret-with-more-than-32-characters';
process.env.V2_DB_PATH = ':memory:';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../db/v2Database');
const { signSession } = require('../lib/authAdapter');
const v2Routes = require('../routes/v2');

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

describe('Guest language preselection in invites & join-info', () => {
  let server;
  let hostToken;
  const userId = 'user-lang-host';
  const orgId = 'org-lang-test';
  const meetingId = 'meeting-lang-1';
  const roomName = 'v2-lang-room-1';

  before(async () => {
    await db.initDatabase();
    await db.run(
      `INSERT OR REPLACE INTO v2_users (id, email, password_hash, display_name)
       VALUES (?,?,?,?)`,
      [userId, 'host@lalia.cloud', 'hash', 'Host User']
    );
    await db.run(
      `INSERT OR REPLACE INTO v2_organizations (id, name, billing_status)
       VALUES (?,?,?)`,
      [orgId, 'Lalia Test Org', 'active']
    );
    await db.run(
      `INSERT OR REPLACE INTO v2_org_members (org_id, user_id, role)
       VALUES (?,?,?)`,
      [orgId, userId, 'owner']
    );
    await db.run(
      `INSERT OR REPLACE INTO v2_org_subscriptions (org_id, plan_id, status)
       VALUES (?,?,?)`,
      [orgId, 'starter', 'active']
    );

    const now = new Date().toISOString();
    await db.run(
      `INSERT OR REPLACE INTO v2_meetings (id, org_id, host_user_id, livekit_room_name, title, status, host_code, started_at, host_present)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [meetingId, orgId, userId, roomName, 'Bilingual Sync', 'live', 'ABCDEF', now, 0]
    );
    await db.run(
      `INSERT OR REPLACE INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts)
       VALUES (?,?,?,?)`,
      [meetingId, 1, 1, 1]
    );

    hostToken = signSession({
      sub: userId,
      email: 'host@lalia.cloud',
      orgId,
      role: 'owner',
    });

    const app = express();
    app.use(express.json());
    app.use('/api/v2', v2Routes);
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('creates an invite link with defaultLanguage and returns joinUrl with &lang=', async () => {
    const res = await requestJson(
      server,
      'POST',
      `/api/v2/meetings/${meetingId}/invites`,
      { expiryMode: 'days_after_start', label: 'Spanish guest', defaultLanguage: 'es-DO' },
      hostToken
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.defaultLanguage, 'es-DO');
    assert.equal(res.body.default_language, 'es-DO');
    assert.match(res.body.joinUrl, /[?&]i=/);
    assert.match(res.body.joinUrl, /&lang=es-DO$/);

    // Verify join-info returns defaultLanguage for this invite token (while waiting_for_host)
    const infoRes = await requestJson(
      server,
      'GET',
      `/api/v2/join-info?roomName=${encodeURIComponent(roomName)}&i=${encodeURIComponent(res.body.token)}`
    );
    assert.equal(infoRes.status, 200);
    assert.equal(infoRes.body.reason, 'waiting_for_host');
    assert.equal(infoRes.body.defaultLanguage, 'es-DO');
    assert.equal(infoRes.body.default_language, 'es-DO');

    // Also verify /api/v2/public/meetings/join-info alias works and honors ?lang= override
    const aliasRes = await requestJson(
      server,
      'GET',
      `/api/v2/public/meetings/join-info?roomName=${encodeURIComponent(roomName)}&i=${encodeURIComponent(res.body.token)}&lang=fr`
    );
    assert.equal(aliasRes.status, 200);
    assert.equal(aliasRes.body.defaultLanguage, 'fr');
    assert.equal(aliasRes.body.default_language, 'fr');
  });

  it('resolves callee preferred_language from v2_contacts on direct-call join-info', async () => {
    const dcMeetingId = 'meeting-dc-1';
    const dcRoomName = 'v2-dc-room-1';
    const dcToken = 'tok-dc-123';
    const futureIso = new Date(Date.now() + 86400000).toISOString();

    await db.run(
      `INSERT INTO v2_meetings (id, org_id, host_user_id, livekit_room_name, title, status, host_code, started_at, host_present)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [dcMeetingId, orgId, userId, dcRoomName, 'Call with Maria', 'live', 'DC1234', new Date().toISOString(), 0]
    );
    await db.run(
      `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts)
       VALUES (?,?,?,?)`,
      [dcMeetingId, 1, 1, 1]
    );
    await db.run(
      `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, reusable, use_count, expiry_mode)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['link-dc-1', dcMeetingId, dcToken, 'Default guest link', futureIso, 1, 0, 'days_after_start']
    );
    await db.run(
      `INSERT INTO v2_contacts (id, owner_user_id, contact_email, contact_name, preferred_language, recipient_status, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      ['contact-maria', userId, 'maria@example.com', 'Maria', 'es', 'accepted', new Date().toISOString()]
    );
    await db.run(
      `INSERT INTO v2_direct_calls (id, caller_user_id, caller_name, caller_email, callee_email, callee_name, meeting_id, room_name, join_url, status, created_at, updated_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        'call-dc-1',
        userId,
        'Host User',
        'host@lalia.cloud',
        'maria@example.com',
        'Maria',
        dcMeetingId,
        dcRoomName,
        `https://lalia.cloud/join/${dcRoomName}?i=${dcToken}&lang=es`,
        'ringing',
        new Date().toISOString(),
        new Date().toISOString(),
        futureIso,
      ]
    );

    const infoRes = await requestJson(
      server,
      'GET',
      `/api/v2/join-info?roomName=${encodeURIComponent(dcRoomName)}&i=${encodeURIComponent(dcToken)}`
    );
    assert.equal(infoRes.status, 200);
    assert.equal(infoRes.body.defaultLanguage, 'es');
    assert.equal(infoRes.body.default_language, 'es');
  });
});
