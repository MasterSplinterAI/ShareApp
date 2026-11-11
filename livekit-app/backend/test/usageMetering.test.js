process.env.V2_DB_PATH = ':memory:';
if (process.env.METERING_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.METERING_TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.LIVEKIT_WEBHOOK_VERIFY = 'false';
process.env.COST_EVENT_SECRET = 'synthetic-usage-test-secret';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/v2Database');
// Prevent all network/notification side effects; exercise real persistence and handlers.
require('../lib/v2UsageCapEnforcement').checkAndEnforceUsageCap = async () => ({ enforced: false });
require('../lib/v2UsageAlerts').evaluateAndSendUsageAlerts = async () => {};
require('../lib/opsHubClient').ingestCogs = async () => {};
const { handleLiveKitWebhook } = require('../routes/webhooks');
const costs = require('../routes/costEvents');
const costHandler = costs.stack.find(x => x.route?.path === '/').route.stack.at(-1).handle;
const { reconcileTranslationMinutesForMeeting } = require('../lib/v2TranslationUsage');
const { webhookTimestamp, reconcileParticipantUsage } = require('../lib/v2ParticipantUsage');
const t0 = Date.now() - 3600000;
const response = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(value) { this.body = value; return this; }, sendStatus(c) { this.statusCode = c; return this; } });
let org;
before(async () => {
  await db.initDatabase(); org = db.uuid();
  await db.run('INSERT INTO v2_organizations(id,name) VALUES (?,?)', [org, 'Synthetic usage test']);
  await db.run('INSERT INTO v2_users(id,email,password_hash) VALUES (?,?,?)', [org, `${org}@example.invalid`, 'not-a-password']);
});
async function meeting() {
  const id = db.uuid();
  await db.run('INSERT INTO v2_meetings(id,org_id,host_user_id,livekit_room_name,host_code) VALUES (?,?,?,?,?)', [id, org, org, id, 'synthetic']); return id;
}
async function hook(room, event, identity, happenedMs, arrivalMs = happenedMs, sid = 'PA_first', eventId) {
  const old = Date.now; Date.now = () => t0 + arrivalMs;
  try {
    const payload = { id: eventId || `${room}-${event}-${identity}-${happenedMs}`, event, createdAt: (t0 + happenedMs) / 1000, room: { name: room }, participant: identity ? { identity, ...(sid ? { sid } : {}) } : undefined };
    const res = response(); await handleLiveKitWebhook({ body: Buffer.from(JSON.stringify(payload)), get: () => '' }, res); assert.equal(res.statusCode, 200);
  } finally { Date.now = old; }
}
async function total(room, type = 'meeting_participant_minute') { return Number((await db.get('SELECT COALESCE(SUM(quantity),0) AS total FROM v2_usage_events WHERE meeting_id=? AND event_type=?', [room, type])).total); }
async function cost(room, units, type = 'deepgram_stt_minute') {
  const res = response(); await costHandler({ body: { meeting_id: room, event_type: type, units }, get: () => process.env.COST_EVENT_SECRET }, res); assert.equal(res.statusCode, 200); return res;
}

test('customer minutes use source timestamps despite delayed webhook delivery', async () => {
  const room = await meeting(); await hook(room, 'participant_joined', 'human', 0); await hook(room, 'participant_left', 'human', 60000, 300000);
  assert.equal(await total(room), 1);
});
test('reconnection pairs exact participant SID despite first disconnect arriving after rejoin', async () => {
  const room = await meeting();
  await hook(room, 'participant_joined', 'human', 0, 0, 'PA_1');
  await hook(room, 'participant_joined', 'human', 120000, 120000, 'PA_2');
  await hook(room, 'participant_left', 'human', 60000, 150000, 'PA_1');
  await hook(room, 'participant_left', 'human', 180000, 180000, 'PA_2');
  assert.equal(await total(room), 2);
});
test('exact SID disconnect takes precedence over a newer legacy identity-only join', async () => {
  const room = await meeting();
  await hook(room, 'participant_joined', 'human', 0, 0, 'PA_exact');
  await hook(room, 'participant_joined', 'human', 30000, 30000, null);
  await hook(room, 'participant_left', 'human', 60000, 60000, 'PA_exact');
  assert.equal(await total(room), 1);
});
test('overlapping humans sum participant time and repeated deliveries do not duplicate usage', async () => {
  const room = await meeting();
  await hook(room, 'participant_joined', 'a', 0, 0, 'PA_a', 'evt-a');
  await hook(room, 'participant_joined', 'a', 0, 10000, 'PA_a', 'evt-a');
  await hook(room, 'participant_joined', 'b', 30000, 30000, 'PA_b');
  await hook(room, 'participant_joined', 'agent-worker', 0, 30000, 'PA_agent');
  await hook(room, 'participant_left', 'a', 60000, 60000, 'PA_a');
  await hook(room, 'participant_left', 'b', 90000, 90000, 'PA_b');
  await hook(room, 'room_finished', null, 120000); await hook(room, 'room_finished', null, 120000, 150000);
  assert.equal(await total(room), 2);
});
test('late exact leave corrects room-end fallback, and leave-before-join delivery recovers', async () => {
  const room = await meeting();
  await hook(room, 'participant_joined', 'human', 0); await hook(room, 'room_finished', null, 180000);
  assert.equal(await total(room), 3);
  await hook(room, 'participant_left', 'human', 60000, 240000);
  assert.equal(await total(room), 1);
  const other = await meeting(); await hook(other, 'participant_left', 'human', 60000, 120000); await hook(other, 'participant_joined', 'human', 0, 180000);
  assert.equal(await total(other), 1);
});
test('legacy identity-only events and their existing usage key are updated without duplicate rows', async () => {
  const room = await meeting(); await hook(room, 'participant_joined', 'legacy', 0, 0, null);
  await db.run('INSERT INTO v2_usage_events(id,org_id,meeting_id,event_type,quantity,unit,idempotency_key) VALUES (?,?,?,?,?,?,?)', [db.uuid(), org, room, 'meeting_participant_minute', 3, 'minute', `${room}:legacy:${t0}`]);
  await hook(room, 'participant_left', 'legacy', 60000, 60000, null);
  assert.equal(await total(room), 1);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM v2_usage_events WHERE meeting_id=?', [room])).n), 1);
});
test('late STT is reconciled after room finish and concurrent reconciliation is idempotent', async () => {
  const room = await meeting(); await cost(room, 0); await hook(room, 'room_finished', null, 60000); await cost(room, 1);
  assert.equal(await total(room, 'translation_minute'), 1);
  await Promise.all(Array.from({ length: 4 }, () => reconcileTranslationMinutesForMeeting(room, org, room)));
  assert.equal(await total(room, 'translation_minute'), 1);
});
test('translation minutes sum each speaker stream independently of meeting elapsed time and ignore TTS', async () => {
  const room = await meeting(); await cost(room, 1); await cost(room, 0.5, 'openai_stt_minute'); await cost(room, 10, 'deepgram_tts_char');
  assert.equal(await total(room, 'translation_minute'), 1.5);
});
test('source timestamp accepts old legitimate backlog but falls back for invalid or future values', () => {
  const receipt = Date.UTC(2026, 10, 11);
  assert.equal(webhookTimestamp({ createdAt: Date.UTC(2020, 0, 1) / 1000 }, receipt), Date.UTC(2020, 0, 1));
  for (const createdAt of [null, '', 'bad', -1, 1, Infinity, receipt / 1000 + 61]) assert.equal(webhookTimestamp({ createdAt }, receipt), receipt);
  assert.equal(webhookTimestamp({}, receipt), receipt);
});
test('existing receipt-timestamp key for a SID session is corrected without adding a second bill', async () => {
  const room = await meeting(); const storedTs = t0 + 30000;
  await db.run('INSERT INTO meeting_events(meeting_id,org_id,event_type,participant_identity,payload_json,ts) VALUES (?,?,?,?,?,?)', [room, org, 'participant_joined', 'human', JSON.stringify({ id: 'old-join', createdAt: t0 / 1000, participant: { identity: 'human', sid: 'PA_first' } }), storedTs]);
  await db.run('INSERT INTO v2_usage_events(id,org_id,meeting_id,event_type,quantity,unit,idempotency_key) VALUES (?,?,?,?,?,?,?)', [db.uuid(), org, room, 'meeting_participant_minute', 3, 'minute', `${room}:human:${storedTs}`]);
  await hook(room, 'participant_left', 'human', 60000, 300000);
  assert.equal(await total(room), 1);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM v2_usage_events WHERE meeting_id=?', [room])).n), 1);
});
test('concurrent reconciliation of a previously unmetered cost row inserts exactly once', async () => {
  const room = await meeting(); await cost(room, 0);
  await db.run('INSERT INTO meeting_cost_events(meeting_id,event_type,provider,units,unit_cost_usd,total_cost_usd,ts) VALUES (?,?,?,?,?,?,?)', [room, 'deepgram_stt_minute', 'deepgram', 2, 0.0105, 0.021, Date.now()]);
  await Promise.all(Array.from({ length: 4 }, () => reconcileTranslationMinutesForMeeting(room, org, room)));
  assert.equal(await total(room, 'translation_minute'), 2);
});
test('reused room reconciles each new session and STT row without treating all future time as ended', async () => {
  const room = await meeting(); await cost(room, 1);
  await hook(room, 'participant_joined', 'human', 0); await hook(room, 'room_finished', null, 60000);
  await hook(room, 'participant_joined', 'human', 120000, 120000, 'PA_second'); await cost(room, 0.5);
  assert.equal(await total(room), 1); // new open session must not end at the historical room_finished
  await hook(room, 'participant_left', 'human', 180000, 180000, 'PA_second');
  assert.equal(await total(room), 2); assert.equal(await total(room, 'translation_minute'), 1.5);
  await Promise.all(Array.from({ length: 3 }, () => reconcileParticipantUsage(room, org, room, () => false)));
  assert.equal(await total(room), 2);
});
test('signed SDK webhook parsing retains timestamp and session SID for customer usage', async () => {
  const { AccessToken } = require('livekit-server-sdk');
  const crypto = require('node:crypto');
  process.env.LIVEKIT_API_KEY = 'synthetic-api-key';
  process.env.LIVEKIT_API_SECRET = 'synthetic-livekit-secret-at-least-32-characters';
  const prior = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try {
    const room = await meeting(); const start = Math.floor(t0 / 1000);
    for (const [event, seconds] of [['participant_joined', start], ['participant_left', start + 60]]) {
      const body = Buffer.from(JSON.stringify({ id: `${room}-${event}`, event, createdAt: String(seconds), room: { name: room }, participant: { identity: 'human', sid: 'PA_signed' } }));
      const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
      token.sha256 = crypto.createHash('sha256').update(body).digest('base64');
      const auth = await token.toJwt(); const res = response();
      await handleLiveKitWebhook({ body, get: () => auth }, res); assert.equal(res.statusCode, 200);
    }
    assert.equal(await total(room), 1);
  } finally { process.env.NODE_ENV = prior; }
});
test('accepted telemetry does not return retry-inducing failure when usage mirror is temporarily unavailable', async () => {
  const room = await meeting(); const originalAll = db.all; const originalError = console.error;
  db.all = async (sql, params) => { if (sql.includes('FROM meeting_cost_events')) throw new Error('synthetic mirror unavailable'); return originalAll(sql, params); };
  console.error = () => {};
  const res = response();
  try { await costHandler({ body: { meeting_id: room, event_type: 'deepgram_stt_minute', units: 1 }, get: () => process.env.COST_EVENT_SECRET }, res); }
  finally { db.all = originalAll; console.error = originalError; }
  assert.equal(res.statusCode, 200); assert.equal(res.body.usage_reconcile_pending, true);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM meeting_cost_events WHERE meeting_id=?', [room])).n), 1);
  await cost(room, 0.5); // the next accepted event retries persisted missing usage
  assert.equal(await total(room, 'translation_minute'), 1.5);
  await reconcileTranslationMinutesForMeeting(room, org, room);
  assert.equal(await total(room, 'translation_minute'), 1.5);
});
test('arrival recovery is bounded and prioritizes the new row before draining remaining backlog', async () => {
  const room = await meeting(); await cost(room, 0);
  for (let i = 0; i < 101; i++) await db.run('INSERT INTO meeting_cost_events(meeting_id,event_type,provider,units,unit_cost_usd,total_cost_usd,ts) VALUES (?,?,?,?,?,?,?)', [room, 'deepgram_stt_minute', 'deepgram', 1, 0.0105, 0.0105, Date.now()]);
  const res = await cost(room, 5);
  assert.equal(res.body.usage_reconcile_pending, true);
  assert.equal(await total(room, 'translation_minute'), 104); // newest5 +99 oldest1-minute rows
  await cost(room, 0.5);
  assert.equal(await total(room, 'translation_minute'), 106.5);
});
