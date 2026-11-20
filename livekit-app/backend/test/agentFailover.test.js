process.env.JWT_SECRET_V2 = 'agent-failover-test-secret-with-more-than-32-chars';
process.env.DATABASE_URL = '';
process.env.V2_DB_PATH = ':memory:';
process.env.V2_SUPERADMIN_EMAILS = 'ops@lalia.test';
process.env.SUPPORT_TELEGRAM_BOT_TOKEN = '123456:env-bot-token';
process.env.SUPPORT_TELEGRAM_CHAT_ID = '99887766';

const { before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/v2Database');
const agentFailover = require('../lib/agentFailover');

before(async () => {
  await db.initDatabase();
});

beforeEach(async () => {
  await db.run('DELETE FROM v2_platform_alert_settings');
  await db.run('DELETE FROM v2_agent_failover_events');
  agentFailover.resetFailoverStateForTests();
});

function makeFakeLivekit({ rooms = [], participantsByRoom = {} } = {}) {
  const roomMap = new Map(rooms.map((r) => [r.name, { ...r }]));
  const removedRooms = [];
  const dispatches = [];
  const metadataWrites = [];

  const livekit = {
    withRoomLock: async (_room, fn) => fn(),
    looksLikeAgentParticipant: (p) => String(p?.identity || '').startsWith('agent-'),
    agentNameForPipeline: (p) =>
      p === 'deepgram_codeswitch'
        ? 'translation-cloud-deepgram-codeswitch'
        : 'translation-selfhosted-xai',
    getRoomService: () => ({
      listRooms: async (names) => (names || []).map((n) => roomMap.get(n)).filter(Boolean),
      listParticipants: async (roomName) => participantsByRoom[roomName] || [],
    }),
    removeAgentsFromRoom: async (roomName) => {
      removedRooms.push(roomName);
    },
    getAgentDispatch: () => ({
      createDispatch: async (roomName, agentName, opts) => {
        dispatches.push({ roomName, agentName, opts });
      },
    }),
  };

  const mergeMetaFn = async (roomName, patch) => {
    const existing = roomMap.get(roomName);
    const meta = existing?.metadata ? JSON.parse(existing.metadata) : {};
    const merged = { ...meta, ...patch };
    if (existing) existing.metadata = JSON.stringify(merged);
    metadataWrites.push({ roomName, merged });
    return merged;
  };

  return { livekit, mergeMetaFn, removedRooms, dispatches, metadataWrites };
}

test('saves alert configuration cleanly, encrypts telegram token, and validates inputs', async () => {
  const invalidReason = await agentFailover.saveAgentAlertSettings('ops@lalia.test', { reason: 'ok' });
  assert.equal(invalidReason.ok, false);

  const invalidTimeout = await agentFailover.saveAgentAlertSettings('ops@lalia.test', {
    reason: 'adjust timeout',
    joinTimeoutSec: 2,
  });
  assert.equal(invalidTimeout.ok, false);

  const saved = await agentFailover.saveAgentAlertSettings('ops@lalia.test', {
    reason: 'configure production alerts',
    joinTimeoutSec: 12,
    circuitCooldownSec: 180,
    alertCooldownMinutes: 20,
    emailRecipients: 'Alice@Lalia.Cloud, bob@lalia.cloud',
    telegramBotToken: '987654321:custom-secret-token',
    telegramChatId: '-1001234567',
    bannerEnabled: false,
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.joinTimeoutSec, 12);
  assert.equal(saved.settings.circuitCooldownSec, 180);
  assert.equal(saved.settings.alertCooldownMinutes, 20);
  assert.equal(saved.settings.bannerEnabled, false);
  assert.deepEqual(saved.settings.effectiveEmails, ['alice@lalia.cloud', 'bob@lalia.cloud']);
  assert.equal(saved.settings.effectiveTelegramBotToken, '987654321:custom-secret-token');
  assert.equal(saved.settings.effectiveTelegramChatId, '-1001234567');

  const rawRow = await db.get(`SELECT telegram_bot_token_enc FROM v2_platform_alert_settings WHERE id = 'default'`);
  assert.ok(rawRow.telegram_bot_token_enc.startsWith('enc:v1:'));

  const adminView = agentFailover.toAgentAlertAdminView(saved.settings);
  assert.equal(adminView.hasTelegramBotToken, true);
  assert.ok(!JSON.stringify(adminView).includes('custom-secret-token'));
});

test('does not fail over when no human participants have joined yet', async () => {
  const fk = makeFakeLivekit({
    rooms: [{ name: 'sched-room', metadata: JSON.stringify({ stt_pipeline: 'selfhosted_xai' }) }],
    participantsByRoom: { 'sched-room': [] },
  });
  const res = await agentFailover.checkRoomSelfHostedHealth('sched-room', {
    livekit: fk.livekit,
    mergeMetaFn: fk.mergeMetaFn,
  });
  assert.equal(res.action, 'awaiting_humans');
  assert.equal(fk.dispatches.length, 0);
  assert.equal(agentFailover.getFailoverRuntimeState().circuitOpen, false);
});

test('fails over human room without selfhosted worker, rate-limits alerts, and auto-recovers when EC2 heals', async () => {
  const emails = [];
  const telegrams = [];
  const sendEmailFn = async (payload) => {
    emails.push(payload);
    return { sent: true, id: `em-${emails.length}` };
  };
  const sendTelegramFn = async (text, cfg) => {
    telegrams.push({ text, cfg });
    return { sent: true, messageId: telegrams.length };
  };

  const fk1 = makeFakeLivekit({
    rooms: [
      {
        name: 'room-1',
        metadata: JSON.stringify({ stt_pipeline: 'selfhosted_xai', org_id: 'org-1' }),
      },
    ],
    participantsByRoom: {
      'room-1': [{ identity: 'host-user-1' }],
    },
  });

  const res1 = await agentFailover.checkRoomSelfHostedHealth('room-1', {
    orgId: 'org-1',
    livekit: fk1.livekit,
    mergeMetaFn: fk1.mergeMetaFn,
    sendEmailFn,
    sendTelegramFn,
  });
  assert.equal(res1.action, 'failed_over');
  assert.equal(res1.agentName, 'translation-cloud-deepgram-codeswitch');
  assert.deepEqual(fk1.removedRooms, ['room-1']);
  assert.equal(fk1.metadataWrites[0].merged.stt_pipeline, 'deepgram_codeswitch');
  assert.equal(fk1.metadataWrites[0].merged.fallback_from, 'selfhosted_xai');
  assert.equal(fk1.dispatches[0].agentName, 'translation-cloud-deepgram-codeswitch');
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to, ['ops@lalia.test']);
  assert.equal(telegrams.length, 1);
  assert.equal(agentFailover.getFailoverRuntimeState().circuitOpen, true);

  // Second failover within cooldown records event but rate-limits outbound Email + Telegram.
  await agentFailover.recordAndNotifyAgentEvent({
    roomName: 'room-2',
    orgId: 'org-1',
    eventKind: 'failover',
    reason: 'circuit_open',
    sendEmailFn,
    sendTelegramFn,
  });
  assert.equal(emails.length, 1);
  assert.equal(telegrams.length, 1);
  const unacked = await agentFailover.listUnacknowledgedFailoverEvents();
  assert.equal(unacked.length, 2);

  // Recovery when EC2 selfhosted worker joins a room closes circuit & notifies.
  const fkRec = makeFakeLivekit({
    rooms: [{ name: 'room-3', metadata: JSON.stringify({ stt_pipeline: 'selfhosted_xai', org_id: 'org-1' }) }],
    participantsByRoom: {
      'room-3': [{ identity: 'host-user-2' }, { identity: 'agent-AJ_healthy' }],
    },
  });
  const resRec = await agentFailover.checkRoomSelfHostedHealth('room-3', {
    livekit: fkRec.livekit,
    mergeMetaFn: fkRec.mergeMetaFn,
    sendEmailFn,
    sendTelegramFn,
  });
  assert.equal(resRec.action, 'healthy');
  assert.equal(agentFailover.getFailoverRuntimeState().circuitOpen, false);
  assert.equal(emails.length, 2);
  assert.match(emails[1].subject, /All Clear/i);
  assert.equal(telegrams.length, 2);

  // Admin test alert + acknowledgement workflow.
  const testDelivery = await agentFailover.sendTestAgentAlert('ops@lalia.test', {
    sendEmailFn,
    sendTelegramFn,
  });
  assert.equal(testDelivery.emailResult.sent, true);
  assert.equal(testDelivery.telegramResult.sent, true);

  const ackRes = await agentFailover.acknowledgeFailoverEvents('ops@lalia.test');
  assert.equal(ackRes.acknowledgedCount, 3);
  assert.equal((await agentFailover.listUnacknowledgedFailoverEvents()).length, 0);
});
