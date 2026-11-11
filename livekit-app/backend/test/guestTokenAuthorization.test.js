process.env.JWT_SECRET_V2 = 'guest-token-test-secret-with-more-than-32-characters';
process.env.DATABASE_URL = '';
process.env.V2_DB_PATH = ':memory:';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-livekit-secret-with-32-characters';
process.env.V2_SUPERADMIN_EMAILS = 'platform@example.test';

const { before, beforeEach, test, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const db = require('../db/v2Database');
const { signSession } = require('../lib/authAdapter');
// Room provisioning is the only external dependency. Exercise the real route,
// database authorization, and LiveKit token minting without contacting LiveKit.
mock.method(require('../lib/livekitService'), 'ensureRoomAndAgent', async () => {});
const router = require('../routes/v2/joinPublic');
const guestToken = router.stack.find((layer) => layer.route?.path === '/guest-token').route.stack[0].handle;

before(async () => {
  await db.initDatabase();
  for (const org of ['meeting-org', 'outside-org']) {
    await db.run('INSERT INTO v2_organizations (id, name, billing_status) VALUES (?,?,?)', [org, org, 'active']);
    await db.run('INSERT INTO v2_org_subscriptions (org_id, plan_id, status) VALUES (?,?,?)', [org, 'starter', 'active']);
  }
  await db.run('INSERT INTO v2_users (id, email, password_hash) VALUES (?,?,?)', ['caller', 'caller@example.test', 'unused']);
  await db.run(`INSERT INTO v2_meetings (id, org_id, host_user_id, livekit_room_name, status, host_present, host_code)
    VALUES (?,?,?,?,?,?,?)`, ['meeting', 'meeting-org', 'caller', 'room', 'live', 1, 'TEST01']);
  await db.run(`INSERT INTO v2_meeting_invite_links (id, meeting_id, token, reusable, use_count, expires_at)
    VALUES (?,?,?,?,?,?)`, ['invite', 'meeting', 'valid-invite', 1, 0, new Date(Date.now() + 3600000).toISOString()]);
});

beforeEach(async () => {
  await db.run('DELETE FROM v2_org_members WHERE user_id = ?', ['caller']);
  await db.run('UPDATE v2_users SET disabled_at = NULL, email = ? WHERE id = ?', ['caller@example.test', 'caller']);
});

async function join({ tokenOrg = 'meeting-org', tokenRole = 'owner', tokenEmail = 'caller@example.test' } = {}) {
  const token = signSession({ sub: 'caller', email: tokenEmail, orgId: tokenOrg, role: tokenRole });
  const req = { headers: { authorization: `Bearer ${token}` }, body: { roomName: 'room', participantName: 'Guest', inviteToken: 'valid-invite' } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await guestToken(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const claims = jwt.verify(res.body.token, process.env.LIVEKIT_API_SECRET);
  assert.equal(claims.video.roomAdmin, false);
  return JSON.parse(claims.metadata);
}

function assertGuest(metadata) {
  assert.equal(metadata.role, 'guest');
  assert.notEqual(metadata.ttsAdmin, true);
  assert.notEqual(metadata.isSuperadmin, true);
  assert.ok(!['owner', 'admin', 'superadmin'].includes(metadata.orgRole));
}

test('an outside workspace owner joins only as a guest', async () => {
  await db.run('INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)', ['outside-org', 'caller', 'owner']);
  assertGuest(await join({ tokenOrg: 'outside-org' }));
});

test('removed membership cannot retain an owner role from an old JWT', async () => {
  assertGuest(await join());
});

test('demoted membership uses its current role', async () => {
  await db.run('INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)', ['meeting-org', 'caller', 'member']);
  assertGuest(await join());
});

test('disabled users cannot exercise their former room privileges', async () => {
  await db.run('INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)', ['meeting-org', 'caller', 'admin']);
  await db.run('UPDATE v2_users SET disabled_at = ? WHERE id = ?', [new Date().toISOString(), 'caller']);
  assertGuest(await join());
});

test('same-workspace admin privileges use fresh membership even when another workspace is selected', async () => {
  await db.run('INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)', ['meeting-org', 'caller', 'admin']);
  const metadata = await join({ tokenOrg: 'outside-org', tokenRole: 'member' });
  assert.equal(metadata.orgRole, 'admin');
  assert.equal(metadata.ttsAdmin, true);
});

test('superadmin authority cannot come from a stale JWT email', async () => {
  assertGuest(await join({ tokenEmail: 'platform@example.test' }));
});

test('an active platform superadmin retains explicit room controls', async () => {
  await db.run('UPDATE v2_users SET email = ? WHERE id = ?', ['platform@example.test', 'caller']);
  const metadata = await join();
  assert.equal(metadata.isSuperadmin, true);
  assert.equal(metadata.ttsAdmin, true);
});
