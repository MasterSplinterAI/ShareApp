const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const tmpDbPath = path.join(os.tmpdir(), `lalia-notetaker-test-${process.pid}-${Date.now()}.sqlite`);
process.env.DATABASE_URL = '';
process.env.V2_DB_PATH = tmpDbPath;
process.env.JWT_SECRET_V2 = 'test-secret-with-more-than-32-characters-notetaker';
process.env.BOT_WORKER_SECRET = 'test-worker-secret-notetaker-123';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const db = require('../db/v2Database');
const { parseExternalMeetingUrl } = require('../lib/externalMeetingUrls');
const { LocalDriver, objectKey, parseHttpByteRange, resetObjectStorage } = require('../lib/objectStorage');
const {
  mintRecordingPlaybackToken,
  verifyRecordingPlaybackToken,
  ingestBotTranscriptLines,
  finalizeBotSessionAndRunPipeline,
} = require('../lib/notetakerPipeline');
const {
  getNotetakerInviteEmail,
  hasNotetakerRecipient,
  parseIcsTimestamp,
  scheduleNotetakerFromParsedEmail,
} = require('../lib/inboundNotetakerInvite');
const {
  assertPublicRecallUrl,
  verifyRequestFromRecall,
  fetchWithRecallRetry,
  buildRecallBotPayload,
  processVerifiedRecallWebhookEvent,
  getNotetakerSettings,
  saveNotetakerSettings,
  toNotetakerAdminView,
  verifyRecallCredentials,
} = require('../lib/recallNotetaker');
const {
  buildCalendarOAuthForwardRedirect,
  evaluateCalendarEventOptIn,
  syncCalendarEventsFromRecall,
} = require('../lib/recallCalendarV2');
const { handleRecallWebhook, drainPendingRecallWebhookJobs } = require('../routes/v2/recallWebhook');
const notetakerRouter = require('../routes/v2/notetaker');
const botInternalRouter = require('../routes/v2/botInternal');
const adminRouter = require('../routes/v2/admin');

async function invokeRouter(router, { method = 'GET', url = '/', headers = {}, body = undefined, query = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      originalUrl: url,
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      body,
      query,
      params: {},
      ip: '127.0.0.1',
      get(name) {
        return this.headers[name.toLowerCase()];
      },
    };
    const resHeaders = {};
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(k, v) {
        resHeaders[k.toLowerCase()] = v;
      },
      getHeader(k) {
        return resHeaders[k.toLowerCase()];
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, headers: resHeaders, body: payload });
      },
      send(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, headers: resHeaders, body: payload });
      },
      end(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, headers: resHeaders, body: payload });
      },
      redirect(statusOrUrl, maybeUrl) {
        this.headersSent = true;
        const code = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
        const location = typeof statusOrUrl === 'number' ? maybeUrl : statusOrUrl;
        resHeaders.location = location;
        resolve({ status: code, headers: resHeaders, location, body: null });
      },
    };
    router.handle(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, headers: resHeaders, body: { error: 'Unhandled route' } });
    });
  });
}

describe('externalMeetingUrls', () => {
  it('parses Google Meet URLs including bare links and calendar snippets', () => {
    const a = parseExternalMeetingUrl('https://meet.google.com/abc-defg-hij?authuser=1');
    assert.equal(a.ok, true);
    assert.equal(a.platform, 'google_meet');
    assert.equal(a.normalizedUrl, 'https://meet.google.com/abc-defg-hij');
    assert.equal(a.externalCode, 'abc-defg-hij');

    const b = parseExternalMeetingUrl('Join call: meet.google.com/xyz-pqrs-tuv');
    assert.equal(b.ok, true);
    assert.equal(b.normalizedUrl, 'https://meet.google.com/xyz-pqrs-tuv');

    const invalid = parseExternalMeetingUrl('https://meet.google.com/not-a-code');
    assert.equal(invalid.ok, false);
  });

  it('parses Microsoft Teams enterprise and live URLs', () => {
    const ent = parseExternalMeetingUrl(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_Zm9vYmFy%40thread.v2/0?context=%7b%22Tid%22%3a%22123%22%7d&utm_source=invite'
    );
    assert.equal(ent.ok, true);
    assert.equal(ent.platform, 'ms_teams');
    assert.ok(ent.normalizedUrl.includes('context='));
    assert.ok(!ent.normalizedUrl.includes('utm_source='));

    const live = parseExternalMeetingUrl('https://teams.live.com/meet/9384729384729?p=secretpass');
    assert.equal(live.ok, true);
    assert.equal(live.platform, 'ms_teams');
    assert.equal(live.externalCode, '9384729384729');
    assert.ok(live.normalizedUrl.includes('p=secretpass'));
  });

  it('parses Zoom and Webex URLs while preserving join params and stripping tracking', () => {
    const zoom = parseExternalMeetingUrl(
      'https://us02web.zoom.us/j/89123456789?pwd=abc123&utm_campaign=invite'
    );
    assert.equal(zoom.ok, true);
    assert.equal(zoom.platform, 'zoom');
    assert.equal(zoom.platformLabel, 'Zoom');
    assert.equal(zoom.externalCode, '89123456789');
    assert.ok(zoom.normalizedUrl.includes('pwd=abc123'));
    assert.ok(!zoom.normalizedUrl.includes('utm_campaign'));

    const bareZoom = parseExternalMeetingUrl('zoom.us/j/55544433322');
    assert.equal(bareZoom.ok, true);
    assert.equal(bareZoom.normalizedUrl, 'https://zoom.us/j/55544433322');

    const webex = parseExternalMeetingUrl(
      'https://acme.webex.com/meet/boardroom?MTID=m12345&utm_source=cal'
    );
    assert.equal(webex.ok, true);
    assert.equal(webex.platform, 'webex');
    assert.equal(webex.platformLabel, 'Webex');
    assert.equal(webex.externalCode, 'boardroom');
    assert.ok(webex.normalizedUrl.includes('MTID=m12345'));
    assert.ok(!webex.normalizedUrl.includes('utm_source'));
  });
});

describe('HTTP Range & Recording Playback Token', () => {
  it('parses byte ranges and streams partial slices via LocalDriver.getRange', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'lalia-range-'));
    const driver = new LocalDriver(root);
    const key = objectKey('org-range', 'recordings/sample.mp3');
    const sample = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz', 'utf8');
    await driver.put(key, sample, { contentType: 'audio/mpeg' });

    const r = await driver.getRange(key, 'bytes=10-15');
    assert.equal(r.partial, true);
    assert.equal(r.start, 10);
    assert.equal(r.end, 15);
    assert.equal(r.contentLength, 6);
    assert.equal(r.totalBytes, sample.length);

    const chunks = [];
    for await (const c of r.stream) chunks.push(c);
    assert.equal(Buffer.concat(chunks).toString('utf8'), 'abcdef');

    const bad = parseHttpByteRange('bytes=999-1000', sample.length);
    assert.equal(bad.unsatisfiable, true);

    await fsp.rm(root, { recursive: true, force: true });
  });

  it('mints and verifies recording playback tokens', () => {
    const tok = mintRecordingPlaybackToken({
      meetingId: 'm-1',
      orgId: 'o-1',
      recordingId: 'r-1',
      ttlSeconds: 300,
    });
    const claims = verifyRecordingPlaybackToken(tok, 'm-1');
    assert.equal(claims.mid, 'm-1');
    assert.equal(claims.oid, 'o-1');
    assert.equal(claims.rid, 'r-1');
    assert.equal(verifyRecordingPlaybackToken(tok, 'other-meeting'), null);
    assert.equal(verifyRecordingPlaybackToken(`${tok}tamper`, 'm-1'), null);
  });
});

describe('End-to-end Notetaker Dispatch -> Worker Claim -> Transcript -> Recording -> Pipeline', () => {
  let storageDir;
  let userToken;
  let orgId;
  let userId;

  before(async () => {
    storageDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lalia-notetaker-uploads-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_DIR = storageDir;
    resetObjectStorage();

    await db.initDatabase();
    userId = db.uuid();
    orgId = db.uuid();
    const cycleId = db.uuid();
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86400000);

    await db.run(
      `INSERT INTO v2_users (id, email, password_hash, display_name) VALUES (?,?,?,?)`,
      [userId, 'kenneth@example.com', 'hash', 'Kenneth Rhule']
    );
    await db.run(
      `INSERT INTO v2_organizations (id, name, billing_status, account_type) VALUES (?,?,?,?)`,
      [orgId, 'Lalia Test Org', 'active', 'team']
    );
    await db.run(
      `INSERT INTO v2_org_members (org_id, user_id, role) VALUES (?,?,?)`,
      [orgId, userId, 'owner']
    );
    await db.run(
      `INSERT INTO v2_org_subscriptions (org_id, plan_id, status, current_period_start, current_period_end)
       VALUES (?,?,?,?,?)`,
      [orgId, 'starter', 'active', now.toISOString(), end.toISOString()]
    );
    await db.run(
      `INSERT INTO v2_billing_cycles (id, org_id, period_start, period_end) VALUES (?,?,?,?)`,
      [cycleId, orgId, now.toISOString(), end.toISOString()]
    );

    userToken = jwt.sign(
      { sub: userId, email: 'kenneth@example.com', orgId, role: 'owner' },
      process.env.JWT_SECRET_V2,
      { expiresIn: '1h' }
    );
  });

  after(async () => {
    await db.close();
    await fsp.rm(tmpDbPath, { force: true }).catch(() => {});
    if (storageDir) {
      await fsp.rm(storageDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('dispatches a Meet bot, claims job, ingests speaker lines, stores MP3, and finalizes', async () => {
    // 1. User dispatches AI Notetaker to a Google Meet URL
    const dispatchRes = await invokeRouter(notetakerRouter, {
      method: 'POST',
      url: '/sessions',
      headers: { Authorization: `Bearer ${userToken}` },
      body: {
        url: 'https://meet.google.com/kbc-mnop-qrs',
        title: 'Client Discovery Call',
        autoRecapMode: 'off',
      },
    });
    assert.equal(dispatchRes.status, 201);
    assert.equal(dispatchRes.body.platform, 'google_meet');
    assert.equal(dispatchRes.body.session.bot_display_name, "Kenneth's Lalia Notetaker");
    const sessionId = dispatchRes.body.session.id;
    const meetingId = dispatchRes.body.meetingId;

    // 2. Worker claims queued job
    const claimRes = await invokeRouter(botInternalRouter, {
      method: 'POST',
      url: '/claim',
      headers: { 'x-bot-worker-secret': process.env.BOT_WORKER_SECRET },
      body: { workerId: 'worker-test-1' },
    });
    assert.equal(claimRes.status, 200);
    assert.equal(claimRes.body.session.id, sessionId);
    const claimToken = claimRes.body.session.claim_token;
    assert.ok(claimToken);

    // 3. Worker heartbeats lobby -> recording
    const hbRes = await invokeRouter(botInternalRouter, {
      method: 'POST',
      url: `/sessions/${sessionId}/heartbeat`,
      headers: {
        'x-bot-worker-secret': process.env.BOT_WORKER_SECRET,
        'x-bot-claim-token': claimToken,
      },
      body: { status: 'recording', statusDetail: 'Recording in Google Meet', joined: true },
    });
    assert.equal(hbRes.status, 200);
    assert.equal(hbRes.body.stopRequested, false);

    // 4. Worker appends speaker-attributed transcript lines
    const trRes = await invokeRouter(botInternalRouter, {
      method: 'POST',
      url: `/sessions/${sessionId}/transcript`,
      headers: {
        'x-bot-worker-secret': process.env.BOT_WORKER_SECRET,
        'x-bot-claim-token': claimToken,
      },
      body: {
        lines: [
          {
            participant_identity: 'Sarah Chen',
            original_text: 'Welcome everyone, let us review the Q4 launch timeline.',
            language: 'en',
            transcription_id: 'utt-1',
            recorded_at: new Date().toISOString(),
          },
          {
            participant_identity: 'Kenneth Rhule',
            original_text: 'Sounds great, S3 storage and annual billing are ready.',
            language: 'en',
            transcription_id: 'utt-2',
            recorded_at: new Date().toISOString(),
          },
        ],
      },
    });
    assert.equal(trRes.status, 200);
    assert.equal(trRes.body.inserted, 2);

    // Duplicate ingest is idempotent
    const dupRes = await ingestBotTranscriptLines(meetingId, [
      {
        participant_identity: 'Sarah Chen',
        original_text: 'Welcome everyone, let us review the Q4 launch timeline.',
        language: 'en',
        transcription_id: 'utt-1',
      },
    ]);
    assert.equal(dupRes.inserted, 0);

    // 5. Store a recording via LocalDriver directly through botInternal handler
    const fakeMp3 = Buffer.from('ID3-fake-mp3-audio-payload-for-test');
    const recRes = await invokeRouter(botInternalRouter, {
      method: 'POST',
      url: `/sessions/${sessionId}/recording`,
      headers: {
        'x-bot-worker-secret': process.env.BOT_WORKER_SECRET,
        'x-bot-claim-token': claimToken,
        'content-type': 'audio/mpeg',
        'x-recording-duration-seconds': '185',
      },
      body: fakeMp3,
    });
    assert.equal(recRes.status, 201);
    assert.equal(recRes.body.bytes, fakeMp3.length);

    // 6. User requests stop, next heartbeat surfaces stopRequested = true
    const stopRes = await invokeRouter(notetakerRouter, {
      method: 'POST',
      url: `/sessions/${sessionId}/stop`,
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(stopRes.status, 200);

    const hbAfterStop = await invokeRouter(botInternalRouter, {
      method: 'POST',
      url: `/sessions/${sessionId}/heartbeat`,
      headers: {
        'x-bot-worker-secret': process.env.BOT_WORKER_SECRET,
        'x-bot-claim-token': claimToken,
      },
      body: { status: 'processing', statusDetail: 'Uploading final audio' },
    });
    assert.equal(hbAfterStop.body.stopRequested, true);

    // 7. Complete session & verify meeting state + usage event
    const fin = await finalizeBotSessionAndRunPipeline(sessionId);
    assert.equal(fin.ok, true);
    assert.equal(fin.lineCount, 2);

    const updatedMeeting = await db.get(`SELECT * FROM v2_meetings WHERE id = ?`, [meetingId]);
    assert.equal(updatedMeeting.status, 'ended');
    assert.equal(updatedMeeting.meeting_source, 'google_meet');

    const usageRow = await db.get(
      `SELECT * FROM v2_usage_events WHERE meeting_id = ? AND event_type = 'notetaker_minutes'`,
      [meetingId]
    );
    assert.ok(usageRow);
    assert.ok(usageRow.quantity > 0);
  });

  it('schedules a future Notetaker session when a Proton Mail user forwards an .ics invite to notes@lalia.cloud', async () => {
    assert.equal(hasNotetakerRecipient({ to: ['notes@lalia.cloud'] }), true);
    assert.equal(hasNotetakerRecipient({ to: ['rsvp+123@lalia.cloud'] }), false);

    const futureDate = new Date(Date.now() + 2 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const dtStartUtc = `${futureDate.getUTCFullYear()}${pad(futureDate.getUTCMonth() + 1)}${pad(futureDate.getUTCDate())}T${pad(futureDate.getUTCHours())}${pad(futureDate.getUTCMinutes())}00Z`;

    const icsSample = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:proton-event-42@proton.me',
      `DTSTART:${dtStartUtc}`,
      'SUMMARY:Board Strategy Sync',
      'LOCATION:https://teams.live.com/meet/9876543210123?p=abc',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const res = await scheduleNotetakerFromParsedEmail({
      fromEmail: 'Kenneth Rhule <kenneth@example.com>',
      subject: 'Fwd: Invitation: Board Strategy Sync',
      textBody: 'Forwarding from Proton Mail',
      icsTexts: [icsSample],
    });

    assert.equal(res.ok, true);
    assert.equal(res.platform, 'ms_teams');
    assert.ok(res.meetingId);

    const session = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [res.sessionId]);
    assert.equal(session.status, 'scheduled');
    assert.equal(session.external_meeting_code, '9876543210123');

    // Forwarding the exact same invite again deduplicates cleanly
    const dup = await scheduleNotetakerFromParsedEmail({
      fromEmail: 'kenneth@example.com',
      icsTexts: [icsSample],
    });
    assert.equal(dup.ok, true);
    assert.equal(dup.deduplicated, true);
    assert.equal(dup.sessionId, res.sessionId);
  });

  it('verifies Recall webhooks (webhook-*, svix-*, multi-sig rotation, replay window), asserts public URLs, retries 429/503/507, and omits chat on Webex', async () => {
    const rawKey = crypto.randomBytes(24).toString('base64');
    const secret = `whsec_${rawKey}`;
    const payload = JSON.stringify({ event: 'bot.done', data: { bot: { id: 'b1' } } });
    const nowSec = Math.floor(Date.now() / 1000);

    const signWithKey = (keyB64, id, ts, body) =>
      crypto.createHmac('sha256', Buffer.from(keyB64, 'base64')).update(`${id}.${ts}.${body}`).digest('base64');

    const sig1 = signWithKey(rawKey, 'msg_std_1', nowSec, payload);
    assert.deepEqual(
      verifyRequestFromRecall({
        secret,
        headers: {
          'webhook-id': 'msg_std_1',
          'webhook-timestamp': String(nowSec),
          'webhook-signature': `v1,deadbeef== v1,${sig1}`,
        },
        rawBody: Buffer.from(payload, 'utf8'),
      }),
      { ok: true, webhookId: 'msg_std_1' }
    );

    const sigSvix = signWithKey(rawKey, 'msg_svix_1', nowSec, payload);
    assert.deepEqual(
      verifyRequestFromRecall({
        secret,
        headers: {
          'svix-id': 'msg_svix_1',
          'svix-timestamp': String(nowSec),
          'svix-signature': `v1,${sigSvix}`,
        },
        rawBody: payload,
      }),
      { ok: true, webhookId: 'msg_svix_1' }
    );

    // Reject expired timestamp / invalid signature / missing secret
    assert.equal(
      verifyRequestFromRecall({
        secret,
        headers: {
          'webhook-id': 'msg_old',
          'webhook-timestamp': String(nowSec - 600),
          'webhook-signature': `v1,${signWithKey(rawKey, 'msg_old', nowSec - 600, payload)}`,
        },
        rawBody: payload,
      }).reason,
      'timestamp_skew'
    );
    assert.equal(
      verifyRequestFromRecall({
        secret: '',
        headers: { 'webhook-id': 'x', 'webhook-timestamp': String(nowSec), 'webhook-signature': `v1,${sig1}` },
        rawBody: payload,
      }).reason,
      'missing_secret'
    );

    // Public URL enforcement
    assert.equal(assertPublicRecallUrl('https://lalia.cloud'), 'https://lalia.cloud');
    assert.throws(() => assertPublicRecallUrl('http://localhost:3101'), /localhost or a private IP/i);
    assert.throws(() => assertPublicRecallUrl('https://127.0.0.1:3101'), /localhost or a private IP/i);
    assert.throws(() => assertPublicRecallUrl('http://10.0.1.5'), /localhost or a private IP/i);

    // Retry 429 (with Retry-After), 503, and 507
    const statuses = [429, 503, 507, 200];
    let attempts = 0;
    const retryRes = await fetchWithRecallRetry(
      'https://us-west-2.recall.ai/api/v1/bot/',
      { method: 'GET' },
      {
        baseDelayMs: 1,
        fetchImpl: async () => {
          const code = statuses[attempts++];
          return {
            ok: code === 200,
            status: code,
            headers: { get: (h) => (h.toLowerCase() === 'retry-after' && code === 429 ? '1' : null) },
            json: async () => ({ ok: true }),
          };
        },
      }
    );
    assert.equal(retryRes.status, 200);
    assert.equal(attempts, 4);

    // Bot payload generation: join_at always present, chat on zoom/meet/teams, omitted on webex
    const baseSettings = {
      transcriptMode: 'recallai_async',
      waitingRoomTimeoutSec: 600,
      everyoneLeftTimeoutSec: 30,
      chatNoticeEnabled: true,
      chatNoticeText: 'Lalia Notetaker is recording this meeting for notes and summary.',
    };
    const zoomPayload = buildRecallBotPayload({
      meetingUrl: 'https://zoom.us/j/123',
      joinAtIso: '2026-12-01T15:00:00.000Z',
      botDisplayName: 'Lalia Notetaker',
      platform: 'zoom',
      settings: baseSettings,
    });
    assert.equal(zoomPayload.join_at, '2026-12-01T15:00:00.000Z');
    assert.equal(zoomPayload.chat?.on_bot_join?.send_to, 'everyone');
    assert.ok(zoomPayload.chat?.on_bot_join?.message.includes('recording'));

    const webexPayload = buildRecallBotPayload({
      meetingUrl: 'https://acme.webex.com/meet/demo',
      joinAtIso: '2026-12-01T15:00:00.000Z',
      botDisplayName: 'Lalia Notetaker',
      platform: 'webex',
      settings: baseSettings,
    });
    assert.equal(webexPayload.chat, undefined);
  });

  it('runs v1.11 Recall flow: POST /sessions -> strict webhook 401/200 + idempotency -> bot.* -> recording.done + create_transcript -> transcript.done -> AI summary + COGS + worker queue isolation', async () => {
    const rawWhKey = crypto.randomBytes(24).toString('base64');
    const webhookSecret = `whsec_${rawWhKey}`;
    const apiKey = 'recall_test_api_key_9876543210';

    const saved = await saveNotetakerSettings('kenny@lalia.cloud', {
      driverMode: 'auto',
      recallRegion: 'us-west-2',
      recallApiKey: apiKey,
      recallWebhookSecret: webhookSecret,
      transcriptMode: 'recallai_async',
      chatNoticeEnabled: true,
      xaiFallbackEnabled: false,
      reason: 'Enable Recall.ai v1.11 async flow in test suite',
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.settings.effectiveDriver, 'recall');

    const adminView = toNotetakerAdminView(saved.settings, { publicBaseUrl: 'https://lalia.cloud' });
    assert.equal(adminView.hasRecallApiKey, true);
    assert.ok(!adminView.recallApiKeyMasked.includes('9876543210'));
    assert.equal(adminView.webhookUrl, 'https://lalia.cloud/api/v2/webhooks/recall');
    assert.equal(adminView.calendarConnectedRedirectUri, 'https://lalia.cloud/api/v2/notetaker/calendar/oauth/callback');

    const verifyRes = await verifyRecallCredentials(
      { apiKey, region: 'us-east-1' },
      {
        fetchImpl: async (url) => {
          if (url.startsWith('https://us-west-2.recall.ai')) return { ok: true, status: 200 };
          return { ok: false, status: 401 };
        },
      }
    );
    assert.equal(verifyRes.ok, true);
    assert.equal(verifyRes.region, 'us-west-2');
    assert.equal(verifyRes.regionAutoDetected, true);

    const origFetch = global.fetch;
    const fakeAudioBytes = Buffer.alloc(2048, 0x41);
    const createdBotId = 'rec-bot-v111-1111';
    const recId = 'rec-recording-2222';
    const trId = 'rec-transcript-3333';
    let createTranscriptBody = null;
    let botCreateSentChat = false;
    let deleteMediaCalled = false;

    global.fetch = async (url, init = {}) => {
      const urlStr = String(url);
      if (urlStr === 'https://us-west-2.recall.ai/api/v1/bot/' && init.method === 'POST') {
        assert.equal(init.headers.Authorization, `Token ${apiKey}`);
        const sent = JSON.parse(init.body);
        assert.ok(sent.meeting_url.includes('zoom.us/j/44455566677'));
        assert.ok(sent.join_at);
        botCreateSentChat = sent.chat?.on_bot_join?.send_to === 'everyone';
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: createdBotId, status_changes: [{ code: 'joining_call' }] }),
        };
      }

      if (urlStr === `https://us-west-2.recall.ai/api/v1/recording/${recId}/` && (!init.method || init.method === 'GET')) {
        assert.equal(init.headers.Authorization, `Token ${apiKey}`);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: recId,
            started_at: '2026-11-20T12:00:00.000Z',
            completed_at: '2026-11-20T12:02:00.000Z',
            media_shortcuts: {
              audio_mixed: {
                status: { code: 'done' },
                data: { download_url: 'https://recall-artifacts.example.com/audio-v111.mp3?sig=1' },
              },
            },
          }),
        };
      }

      if (urlStr === 'https://recall-artifacts.example.com/audio-v111.mp3?sig=1') {
        assert.equal(init.headers?.Authorization, undefined);
        return { ok: true, status: 200, arrayBuffer: async () => fakeAudioBytes };
      }

      if (
        urlStr === `https://us-west-2.recall.ai/api/v1/recording/${recId}/create_transcript/` &&
        init.method === 'POST'
      ) {
        assert.equal(init.headers.Authorization, `Token ${apiKey}`);
        createTranscriptBody = JSON.parse(init.body);
        return { ok: true, status: 201, json: async () => ({ id: trId, status: { code: 'processing' } }) };
      }

      if (urlStr === `https://us-west-2.recall.ai/api/v1/transcript/${trId}/` && (!init.method || init.method === 'GET')) {
        assert.equal(init.headers.Authorization, `Token ${apiKey}`);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: trId,
            data: { download_url: 'https://recall-artifacts.example.com/transcript-v111.json?sig=2' },
          }),
        };
      }

      if (urlStr === 'https://recall-artifacts.example.com/transcript-v111.json?sig=2') {
        assert.equal(init.headers?.Authorization, undefined);
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              participant: { name: 'Alice Host' },
              words: [
                { text: 'Hello', start_timestamp: { relative: 0.1 }, end_timestamp: { relative: 0.3 } },
                { text: 'everyone.', start_timestamp: { relative: 0.4 }, end_timestamp: { relative: 0.8 } },
              ],
            },
            {
              participant: { name: 'Bob Guest' },
              words: [
                { text: 'Welcome', start_timestamp: { relative: 1.5 }, end_timestamp: { relative: 1.9 } },
                { text: 'today.', start_timestamp: { relative: 2.0 }, end_timestamp: { relative: 2.3 } },
              ],
            },
            {
              participant: { name: "Kenneth's Lalia Notetaker" },
              text: 'Bot name filtered out',
            },
          ],
        };
      }

      if (urlStr === `https://us-west-2.recall.ai/api/v1/bot/${createdBotId}/delete_media/`) {
        deleteMediaCalled = true;
        return { ok: true, status: 204 };
      }

      throw new Error(`Unexpected fetch in v1.11 test: ${urlStr}`);
    };

    try {
      const dispatchRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: '/sessions',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          url: 'https://zoom.us/j/44455566677?pwd=xyz',
          title: 'Recall v1.11 Async Test',
          autoRecapMode: 'off',
        },
      });
      assert.equal(dispatchRes.status, 201);
      assert.equal(dispatchRes.body.platform, 'zoom');
      assert.equal(dispatchRes.body.session.bot_provider, 'recall');
      assert.equal(dispatchRes.body.session.external_bot_id, createdBotId);
      assert.equal(botCreateSentChat, true);
      const recallSessionId = dispatchRes.body.session.id;
      const recallMeetingId = dispatchRes.body.meetingId;

      // Worker queue stays isolated from Recall sessions
      const workerClaim = await invokeRouter(botInternalRouter, {
        method: 'POST',
        url: '/claim',
        headers: { 'x-bot-worker-secret': process.env.BOT_WORKER_SECRET },
        body: { workerId: 'worker-test-ignore' },
      });
      assert.equal(workerClaim.status, 200);
      assert.equal(workerClaim.body.session, null);

      const signStandard = (msgId, payloadStr) => {
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = crypto
          .createHmac('sha256', Buffer.from(rawWhKey, 'base64'))
          .update(`${msgId}.${ts}.${payloadStr}`)
          .digest('base64');
        return {
          'webhook-id': msgId,
          'webhook-timestamp': ts,
          'webhook-signature': `v1,${sig}`,
        };
      };

      const callWebhook = async (rawText, headers) =>
        new Promise((resolve) => {
          const res = {
            statusCode: 200,
            status(c) {
              this.statusCode = c;
              return this;
            },
            json(payload) {
              resolve({ status: this.statusCode, body: payload });
            },
          };
          handleRecallWebhook({ headers, body: Buffer.from(rawText, 'utf8') }, res);
        });

      // Unverified request rejected 401
      const badBody = JSON.stringify({
        event: 'bot.in_waiting_room',
        data: { bot: { id: createdBotId }, data: { code: 'in_waiting_room' } },
      });
      const badWh = await callWebhook(badBody, {
        'webhook-id': 'msg_bad',
        'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'webhook-signature': 'v1,invalid',
      });
      assert.equal(badWh.status, 401);

      // 1. bot.in_waiting_room -> 200 queued + idempotency on duplicate webhook-id
      const lobbyWh = await callWebhook(badBody, signStandard('wh_lobby_1', badBody));
      assert.equal(lobbyWh.status, 200);
      assert.equal(lobbyWh.body.queued, true);
      await drainPendingRecallWebhookJobs();

      const dupWh = await callWebhook(badBody, signStandard('wh_lobby_1', badBody));
      assert.equal(dupWh.status, 200);
      assert.equal(dupWh.body.duplicate, true);

      const midSession = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [recallSessionId]);
      assert.equal(midSession.status, 'waiting_in_lobby');

      // 2. bot.in_call_recording -> recording + meeting live
      const recStartBody = JSON.stringify({
        event: 'bot.in_call_recording',
        data: { bot: { id: createdBotId }, data: { code: 'in_call_recording', updated_at: '2026-11-20T12:00:00.000Z' } },
      });
      const recStartWh = await callWebhook(recStartBody, signStandard('wh_recstart_2', recStartBody));
      assert.equal(recStartWh.status, 200);
      await drainPendingRecallWebhookJobs();
      const recSession = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [recallSessionId]);
      assert.equal(recSession.status, 'recording');
      assert.ok(recSession.joined_at);

      // 3. recording.done -> S3 MP3 saved + POST create_transcript (recallai_async)
      const recDoneBody = JSON.stringify({
        event: 'recording.done',
        data: { bot: { id: createdBotId }, recording: { id: recId }, data: { code: 'done' } },
      });
      const recDoneWh = await callWebhook(recDoneBody, signStandard('wh_recdone_3', recDoneBody));
      assert.equal(recDoneWh.status, 200);
      await drainPendingRecallWebhookJobs();

      assert.deepEqual(createTranscriptBody, {
        provider: { recallai_async: { language_code: 'auto' } },
        diarization: { use_separate_streams_when_available: true },
      });
      const recRow = await db.get(`SELECT * FROM v2_meeting_recordings WHERE bot_session_id = ?`, [recallSessionId]);
      assert.ok(recRow);
      assert.equal(recRow.size_bytes, fakeAudioBytes.length);
      assert.equal(recRow.duration_seconds, 120);

      // 4. transcript.done -> speaker-grouped transcript lines + COGS + completed
      const trDoneBody = JSON.stringify({
        event: 'transcript.done',
        data: {
          bot: { id: createdBotId },
          recording: { id: recId },
          transcript: { id: trId },
          data: { code: 'done' },
        },
      });
      const trDoneWh = await callWebhook(trDoneBody, signStandard('wh_trdone_4', trDoneBody));
      assert.equal(trDoneWh.status, 200);
      await drainPendingRecallWebhookJobs();

      const finalSession = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [recallSessionId]);
      assert.equal(finalSession.status, 'completed');
      assert.equal(finalSession.external_recording_id, recId);
      assert.equal(finalSession.external_transcript_id, trId);
      assert.ok(finalSession.ingested_at);

      const lines = await db.all(
        `SELECT participant_identity, original_text FROM v2_meeting_transcript_lines WHERE meeting_id = ? ORDER BY recorded_at ASC`,
        [recallMeetingId]
      );
      assert.equal(lines.length, 2);
      assert.equal(lines[0].participant_identity, 'Alice Host');
      assert.equal(lines[0].original_text, 'Hello everyone.');
      assert.equal(lines[1].participant_identity, 'Bob Guest');
      assert.equal(lines[1].original_text, 'Welcome today.');

      const meetingRow = await db.get(`SELECT * FROM v2_meetings WHERE id = ?`, [recallMeetingId]);
      const costRows = await db.all(
        `SELECT * FROM meeting_cost_events WHERE meeting_id = ? ORDER BY id ASC`,
        [meetingRow.livekit_room_name]
      );
      assert.equal(costRows.length, 1);
      assert.equal(costRows[0].event_type, 'recall_bot_minute');

      const rollupRow = await db.get(`SELECT * FROM meeting_cost_rollups WHERE meeting_id = ?`, [
        meetingRow.livekit_room_name,
      ]);
      assert.ok(rollupRow);
      assert.ok(rollupRow.total_cost_usd > 0);
      assert.equal(deleteMediaCalled, true);

      const whEventRows = await db.all(`SELECT status FROM v2_recall_webhook_events`);
      assert.ok(whEventRows.length >= 4);
      assert.ok(whEventRows.every((r) => r.status === 'processed'));
    } finally {
      global.fetch = origFetch;
    }
  });

  it('handles Webex stop (cancel vs leave_call), admin /notetaker/* routes, Calendar OAuth forwarding/probe, in-app connect OAuth flow, Calendar V2 opt-in sync, and per-event recording toggle', async () => {
    const prevSuperadmins = process.env.V2_SUPERADMIN_EMAILS;
    const prevGoogleClientId = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID;
    const prevGoogleClientSecret = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET;
    const prevPublicBase = process.env.PUBLIC_API_BASE_URL;
    const origFetch = global.fetch;
    process.env.V2_SUPERADMIN_EMAILS = 'kenneth@example.com';
    process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID = 'google-client-id-test.apps.googleusercontent.com';
    process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET = 'google-client-secret-test';
    process.env.PUBLIC_API_BASE_URL = 'https://lalia.cloud';

    const apiKey = 'recall_calendar_test_key_123456';
    const rawWhKey = crypto.randomBytes(24).toString('base64');
    const webhookSecret = `whsec_${rawWhKey}`;

    const patchAdminRes = await invokeRouter(adminRouter, {
      method: 'PATCH',
      url: '/notetaker/config',
      headers: { Authorization: `Bearer ${userToken}` },
      body: {
        driverMode: 'recall',
        recallRegion: 'us-west-2',
        recallApiKey: apiKey,
        recallWebhookSecret: webhookSecret,
        transcriptMode: 'recallai_async',
        chatNoticeEnabled: true,
        calendarRegionalCallbackUri: 'https://us-west-2.recall.ai/api/v1/calendar/google_oauth_callback/',
        reason: 'Test Calendar V2 and stop endpoints',
      },
    });
    assert.equal(patchAdminRes.status, 200);
    assert.equal(patchAdminRes.body.settings.hasCalendarRegionalCallbackUri, true);

    const statusRes = await invokeRouter(notetakerRouter, {
      method: 'GET',
      url: '/status',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.driver, 'recall');
    assert.equal(statusRes.body.ready, true);

    // Calendar OAuth callback forwarding & probe tests
    const probeRes = await invokeRouter(notetakerRouter, {
      method: 'GET',
      url: '/calendar/oauth/callback',
      query: { state: 'opaque-state-1', recall_calendar_setup_probe: '1' },
    });
    assert.equal(probeRes.status, 302);
    assert.ok(probeRes.location.startsWith('https://us-west-2.recall.ai/api/v1/calendar/google_oauth_callback/'));
    assert.ok(probeRes.location.includes('state=opaque-state-1'));
    assert.ok(probeRes.location.includes('recall_calendar_setup_probe=1'));

    const oauthCodeRes = await invokeRouter(notetakerRouter, {
      method: 'GET',
      url: '/calendar/oauth/callback',
      query: { state: 'opaque-state-2', code: 'oauth-auth-code-xyz' },
    });
    assert.equal(oauthCodeRes.status, 302);
    assert.ok(oauthCodeRes.location.includes('code=oauth-auth-code-xyz'));

    const invalidFwd = buildCalendarOAuthForwardRedirect(
      { state: 's', code: 'c', error: 'access_denied' },
      { recallRegion: 'us-west-2' }
    );
    assert.equal(invalidFwd.ok, false);
    assert.equal(invalidFwd.status, 400);

    let nextBotNum = 1;
    const deletedBots = [];
    const leaveCallBots = [];
    const calendarBotCalls = [];
    const deletedCalendarBots = [];
    const deletedCalendars = [];
    let webexSentChat = false;

    const futureStart1 = new Date(Date.now() + 3600_000).toISOString();
    const futureEnd1 = new Date(Date.now() + 5400_000).toISOString();
    const futureStart2 = new Date(Date.now() + 7200_000).toISOString();
    const futureEnd2 = new Date(Date.now() + 9000_000).toISOString();
    const pastStart = new Date(Date.now() - 7200_000).toISOString();
    const pastEnd = new Date(Date.now() - 3600_000).toISOString();
    const recallCalId = 'cal-v2-uuid-1';

    global.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u === 'https://us-west-2.recall.ai/api/v1/bot/' && init.method === 'POST') {
        const sent = JSON.parse(init.body);
        if (sent.meeting_url?.includes('webex.com') && sent.chat) {
          webexSentChat = true;
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: `rec-stop-${nextBotNum++}`, status_changes: [{ code: 'joining_call' }] }),
        };
      }
      if (u.startsWith('https://us-west-2.recall.ai/api/v1/bot/') && init.method === 'DELETE') {
        deletedBots.push(u);
        return { ok: true, status: 204 };
      }
      if (u.endsWith('/leave_call/') && init.method === 'POST') {
        leaveCallBots.push(u);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (u === `https://us-west-2.recall.ai/api/v2/calendars/${recallCalId}/` && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: recallCalId,
            platform: 'google_calendar',
            platform_email: 'kenneth@example.com',
            status: 'connected',
          }),
        };
      }
      if (u === `https://us-west-2.recall.ai/api/v2/calendars/${recallCalId}/` && init.method === 'DELETE') {
        deletedCalendars.push(u);
        return { ok: true, status: 204 };
      }
      if (u.startsWith(`https://us-west-2.recall.ai/api/v2/calendar-events/?calendar_id=${recallCalId}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            next: null,
            results: [
              {
                id: 'cal-ev-org-meet',
                platform: 'google_calendar',
                start_time: futureStart1,
                end_time: futureEnd1,
                meeting_url: 'https://meet.google.com/org-meet-abc',
                is_deleted: false,
                raw: { summary: 'Weekly Sync (I Organize)', organizer: { email: 'kenneth@example.com' } },
              },
              {
                id: 'cal-ev-other-zoom',
                platform: 'google_calendar',
                start_time: futureStart2,
                end_time: futureEnd2,
                meeting_url: 'https://zoom.us/j/999888777?pwd=abc',
                is_deleted: false,
                raw: { summary: 'External Vendor Demo', organizer: { email: 'vendor@example.com' } },
              },
              {
                id: 'cal-ev-nolink',
                platform: 'google_calendar',
                start_time: futureStart1,
                end_time: futureEnd1,
                meeting_url: null,
                is_deleted: false,
                raw: { summary: 'Focus Time Block', organizer: { email: 'kenneth@example.com' } },
              },
              {
                id: 'cal-ev-past',
                platform: 'google_calendar',
                start_time: pastStart,
                end_time: pastEnd,
                meeting_url: 'https://meet.google.com/old-meet-xyz',
                is_deleted: false,
                raw: { summary: 'Yesterday Standup', organizer: { email: 'kenneth@example.com' } },
              },
            ],
          }),
        };
      }
      if (u.startsWith('https://us-west-2.recall.ai/api/v2/calendar-events/') && u.endsWith('/bot/') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        calendarBotCalls.push({ url: u, body });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: u.split('/').slice(-3, -2)[0], bots: [{ id: `cal-bot-${calendarBotCalls.length}` }] }),
        };
      }
      if (u.startsWith('https://us-west-2.recall.ai/api/v2/calendar-events/') && u.endsWith('/bot/') && init.method === 'DELETE') {
        deletedCalendarBots.push(u);
        return { ok: true, status: 204 };
      }
      if (u === 'https://oauth2.googleapis.com/token' && init.method === 'POST') {
        assert.ok(String(init.body).includes('code=google-auth-code-123'));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ya29.test',
            refresh_token: '1//google-refresh-token-test',
          }),
        };
      }
      if (u === 'https://us-west-2.recall.ai/api/v2/calendars/' && init.method === 'POST') {
        const sent = JSON.parse(init.body);
        assert.equal(sent.platform, 'google_calendar');
        assert.equal(sent.oauth_client_id, 'google-client-id-test.apps.googleusercontent.com');
        assert.equal(sent.oauth_refresh_token, '1//google-refresh-token-test');
        assert.equal(sent.metadata?.lalia_user_id, userId);
        assert.equal(sent.metadata?.lalia_org_id, orgId);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'cal-oauth-2',
            platform: 'google_calendar',
            platform_email: 'second@example.com',
            status: 'connected',
            metadata: sent.metadata,
          }),
        };
      }
      if (u.startsWith('https://us-west-2.recall.ai/api/v2/calendar-events/?calendar_id=cal-oauth-2')) {
        return { ok: true, status: 200, json: async () => ({ next: null, results: [] }) };
      }
      throw new Error(`Unexpected fetch in Calendar/Stop test: ${u}`);
    };

    try {
      // Scheduled Webex bot -> omits chat, stop triggers DELETE
      const schedRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: '/sessions',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          url: 'https://acme.webex.com/meet/exec-sync',
          scheduledFor: futureStart1,
          autoRecapMode: 'off',
        },
      });
      assert.equal(schedRes.status, 201);
      assert.equal(webexSentChat, false);

      const cancelRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: `/sessions/${schedRes.body.session.id}/stop`,
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(cancelRes.status, 200);
      assert.equal(cancelRes.body.session.status, 'canceled');
      assert.equal(deletedBots.length, 1);

      // Live Google Meet bot -> stop triggers leave_call
      const liveRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: '/sessions',
        headers: { Authorization: `Bearer ${userToken}` },
        body: { url: 'https://meet.google.com/aaa-bbbb-ccc', autoRecapMode: 'off' },
      });
      assert.equal(liveRes.status, 201);
      const leaveRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: `/sessions/${liveRes.body.session.id}/stop`,
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(leaveRes.status, 200);
      assert.equal(leaveCallBots.length, 1);

      // Calendar V2: calendar.update connects Kenneth's calendar (default manual opt-in -> 0 auto-bots)
      await processVerifiedRecallWebhookEvent({
        event: 'calendar.update',
        data: { calendar_id: recallCalId },
      });
      const calSyncRes = await processVerifiedRecallWebhookEvent({
        event: 'calendar.sync_events',
        data: { calendar_id: recallCalId },
      });
      assert.equal(calSyncRes.ok, true);
      assert.equal(calSyncRes.eventsProcessed, 4);
      assert.equal(calSyncRes.scheduledCount, 0);

      const listCalRes = await invokeRouter(notetakerRouter, {
        method: 'GET',
        url: '/calendars',
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(listCalRes.status, 200);
      assert.equal(listCalRes.body.calendars.length, 1);
      const connId = listCalRes.body.calendars[0].id;
      assert.equal(listCalRes.body.calendars[0].auto_join_rule, 'manual');

      const eventsRes = await invokeRouter(notetakerRouter, {
        method: 'GET',
        url: '/calendar-events',
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(eventsRes.status, 200);
      assert.equal(eventsRes.body.events.length, 3); // past event filtered out by end_time >= now-1h

      const vendorZoomEv = eventsRes.body.events.find((e) => e.recall_event_id === 'cal-ev-other-zoom');
      const noLinkEv = eventsRes.body.events.find((e) => e.recall_event_id === 'cal-ev-nolink');
      assert.ok(vendorZoomEv && noLinkEv);

      // Attempting to toggle event with no supported video link fails 400
      const noLinkToggle = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: `/calendar-events/${noLinkEv.id}/toggle`,
        headers: { Authorization: `Bearer ${userToken}` },
        body: { enabled: true },
      });
      assert.equal(noLinkToggle.status, 400);

      // Manual opt-in ON for vendor Zoom event -> schedules Calendar V2 bot with deduplication_key & no meeting_url
      const optInRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: `/calendar-events/${vendorZoomEv.id}/toggle`,
        headers: { Authorization: `Bearer ${userToken}` },
        body: { enabled: true },
      });
      assert.equal(optInRes.status, 200);
      assert.equal(calendarBotCalls.length, 1);
      assert.equal(calendarBotCalls[0].body.deduplication_key, `${futureStart2}-https://zoom.us/j/999888777?pwd=abc`);
      assert.equal(calendarBotCalls[0].body.bot_config.meeting_url, undefined);
      assert.equal(optInRes.body.event.scheduled_bot_id, 'cal-bot-1');

      // Manual opt-out OFF for vendor Zoom event -> DELETE calendar-events/:id/bot/
      const optOutRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: `/calendar-events/${vendorZoomEv.id}/toggle`,
        headers: { Authorization: `Bearer ${userToken}` },
        body: { enabled: false },
      });
      assert.equal(optOutRes.status, 200);
      assert.equal(deletedCalendarBots.length, 1);
      assert.equal(optOutRes.body.event.scheduled_bot_id, null);

      // Switch calendar default to organizer_only -> schedules ONLY Weekly Sync (I Organize), skips vendor/past/no-link
      const patchCalRes = await invokeRouter(notetakerRouter, {
        method: 'PATCH',
        url: `/calendars/${connId}`,
        headers: { Authorization: `Bearer ${userToken}` },
        body: { autoJoinRule: 'organizer_only' },
      });
      assert.equal(patchCalRes.status, 200);
      assert.equal(patchCalRes.body.calendar.auto_join_rule, 'organizer_only');
      assert.equal(calendarBotCalls.length, 2);
      assert.ok(calendarBotCalls[1].url.includes('cal-ev-org-meet'));

      // Check evaluateCalendarEventOptIn explicitly skips past event
      assert.equal(
        evaluateCalendarEventOptIn(
          { is_deleted: 0, end_time: pastEnd, normalized_meeting_url: 'https://meet.google.com/old-meet-xyz' },
          { auto_join_rule: 'all_with_link', account_email: 'kenneth@example.com' }
        ).reason,
        'event_ended'
      );

      // Disconnect calendar -> DELETE /api/v2/calendars/{id}/ & cancels scheduled bot
      const delCalRes = await invokeRouter(notetakerRouter, {
        method: 'DELETE',
        url: `/calendars/${connId}`,
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(delCalRes.status, 200);
      assert.equal(deletedCalendars.length, 1);

      // In-app Connect Google Calendar OAuth flow: GET /calendars -> POST /calendars/connect-url -> GET /calendar/oauth/callback?state=lalia:...&code=...
      assert.equal(listCalRes.body.oauthConfigured, true);
      const connectUrlRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: '/calendars/connect-url',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {},
      });
      assert.equal(connectUrlRes.status, 200);
      const authUrlObj = new URL(connectUrlRes.body.url);
      assert.equal(authUrlObj.origin, 'https://accounts.google.com');
      assert.equal(authUrlObj.searchParams.get('redirect_uri'), 'https://lalia.cloud/api/v2/notetaker/calendar/oauth/callback');
      assert.equal(authUrlObj.searchParams.get('access_type'), 'offline');
      const signedState = authUrlObj.searchParams.get('state');
      assert.ok(signedState && signedState.startsWith('lalia:'));

      const oauthCompleteRes = await invokeRouter(notetakerRouter, {
        method: 'GET',
        url: '/calendar/oauth/callback',
        query: { state: signedState, code: 'google-auth-code-123' },
      });
      assert.equal(oauthCompleteRes.status, 302);
      assert.equal(oauthCompleteRes.location, 'https://lalia.cloud/v2/app/meetings?calendar=connected');

      const afterOauthCal = await db.get(
        `SELECT account_email, status, recall_calendar_id FROM v2_calendar_connections WHERE recall_calendar_id = 'cal-oauth-2'`
      );
      assert.equal(afterOauthCal.account_email, 'second@example.com');
      assert.equal(afterOauthCal.status, 'connected');
    } finally {
      global.fetch = origFetch;
      if (prevSuperadmins === undefined) delete process.env.V2_SUPERADMIN_EMAILS;
      else process.env.V2_SUPERADMIN_EMAILS = prevSuperadmins;
      if (prevGoogleClientId === undefined) delete process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID = prevGoogleClientId;
      if (prevGoogleClientSecret === undefined) delete process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET = prevGoogleClientSecret;
      if (prevPublicBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = prevPublicBase;
    }
  });

  it('connects Microsoft Outlook Calendar V2 with PS256 certificate assertion and schedules/cancels notes@invite.lalia.cloud Outlook TZID invites', async () => {
    const { execFileSync } = require('node:child_process');
    const tmpCertDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lalia-ms-cert-'));
    const certPath = path.join(tmpCertDir, 'cert.crt');
    const keyPath = path.join(tmpCertDir, 'private.key');
    execFileSync('openssl', [
      'req',
      '-new',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '365',
      '-nodes',
      '-sha256',
      '-subj',
      '/CN=Lalia Outlook Test',
    ]);
    const certPem = (await fsp.readFile(certPath, 'utf8')).trim();
    const keyPem = (await fsp.readFile(keyPath, 'utf8')).trim();

    const prevMsClientId = process.env.MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID;
    const prevMsCertPem = process.env.MICROSOFT_OUTLOOK_OAUTH_CERT_PEM;
    const prevMsKeyPem = process.env.MICROSOFT_OUTLOOK_OAUTH_PRIVATE_KEY_PEM;
    const prevPublicBase = process.env.PUBLIC_API_BASE_URL;

    process.env.MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID = 'ms-app-client-id-123';
    process.env.MICROSOFT_OUTLOOK_OAUTH_CERT_PEM = certPem;
    process.env.MICROSOFT_OUTLOOK_OAUTH_PRIVATE_KEY_PEM = keyPem;
    process.env.PUBLIC_API_BASE_URL = 'https://lalia.cloud';

    const origFetch = global.fetch;
    const recallBotDeletes = [];
    const recallBotCreates = [];

    global.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u === 'https://login.microsoftonline.com/common/oauth2/v2.0/token' && init.method === 'POST') {
        const params = new URLSearchParams(String(init.body || ''));
        assert.equal(params.get('code'), 'ms-auth-code-999');
        assert.equal(params.get('client_id'), 'ms-app-client-id-123');
        assert.equal(params.get('redirect_uri'), 'https://lalia.cloud/api/v2/notetaker/calendar/oauth/callback');
        assert.equal(
          params.get('client_assertion_type'),
          'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
        );
        const assertion = params.get('client_assertion');
        assert.ok(assertion);
        const [hdrB64, claimsB64] = assertion.split('.');
        const hdr = JSON.parse(Buffer.from(hdrB64, 'base64url').toString('utf8'));
        const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf8'));
        assert.equal(hdr.alg, 'PS256');
        assert.ok(hdr['x5t#S256']);
        assert.equal(claims.iss, 'ms-app-client-id-123');
        assert.equal(claims.aud, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ms-access-token',
            refresh_token: 'ms-refresh-token-123',
            expires_in: 3600,
          }),
        };
      }
      if (u === 'https://us-west-2.recall.ai/api/v2/calendars/' && init.method === 'POST') {
        const sent = JSON.parse(init.body);
        assert.equal(sent.platform, 'microsoft_outlook');
        assert.equal(sent.oauth_client_id, 'ms-app-client-id-123');
        assert.equal(sent.oauth_client_secret, undefined);
        assert.equal(sent.oauth_client_certificate, certPem);
        assert.equal(sent.oauth_client_private_key, keyPem);
        assert.equal(sent.oauth_refresh_token, 'ms-refresh-token-123');
        assert.equal(sent.metadata?.lalia_user_id, userId);
        assert.equal(sent.metadata?.lalia_org_id, orgId);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'cal-ms-1',
            platform: 'microsoft_outlook',
            platform_email: 'outlook-user@outlook.com',
            status: 'connected',
            metadata: sent.metadata,
          }),
        };
      }
      if (u.startsWith('https://us-west-2.recall.ai/api/v2/calendar-events/?calendar_id=cal-ms-1')) {
        return { ok: true, status: 200, json: async () => ({ next: null, results: [] }) };
      }
      if (u === 'https://us-west-2.recall.ai/api/v1/bot/' && init.method === 'POST') {
        const body = JSON.parse(init.body);
        recallBotCreates.push(body);
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'rec-ms-invite-bot-1', status_changes: [{ code: 'joining_call' }] }),
        };
      }
      if (u === 'https://us-west-2.recall.ai/api/v1/bot/rec-ms-invite-bot-1/' && init.method === 'DELETE') {
        recallBotDeletes.push(u);
        return { ok: true, status: 204 };
      }
      throw new Error(`Unexpected fetch in Microsoft Outlook test: ${u}`);
    };

    try {
      const listRes = await invokeRouter(notetakerRouter, {
        method: 'GET',
        url: '/calendars',
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(listRes.status, 200);
      assert.equal(listRes.body.providers.microsoft_outlook.oauthConfigured, true);
      assert.equal(listRes.body.inviteEmail, getNotetakerInviteEmail());

      const connectRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: '/calendars/connect-url',
        headers: { Authorization: `Bearer ${userToken}` },
        body: { provider: 'microsoft_outlook' },
      });
      assert.equal(connectRes.status, 200);
      assert.equal(connectRes.body.provider, 'microsoft_outlook');
      const authUrl = new URL(connectRes.body.url);
      assert.equal(authUrl.origin, 'https://login.microsoftonline.com');
      assert.equal(authUrl.pathname, '/common/oauth2/v2.0/authorize');
      assert.ok(authUrl.searchParams.get('scope').includes('https://graph.microsoft.com/Calendars.Read'));
      const msState = authUrl.searchParams.get('state');
      assert.ok(msState && msState.startsWith('lalia:'));

      const cbRes = await invokeRouter(notetakerRouter, {
        method: 'GET',
        url: '/calendar/oauth/callback',
        query: { state: msState, code: 'ms-auth-code-999' },
      });
      assert.equal(cbRes.status, 302);
      assert.equal(
        cbRes.location,
        'https://lalia.cloud/v2/app/meetings?calendar=connected&provider=microsoft_outlook'
      );

      const msConn = await db.get(
        `SELECT provider, account_email, status FROM v2_calendar_connections WHERE recall_calendar_id = 'cal-ms-1'`
      );
      assert.equal(msConn.provider, 'microsoft_outlook');
      assert.equal(msConn.account_email, 'outlook-user@outlook.com');
      assert.equal(msConn.status, 'connected');

      // Verify Windows TZID parsing from Outlook .ics (Nov 21, 2026 15:00 EST -> 20:00Z)
      const tzParsed = parseIcsTimestamp('DTSTART;TZID="Eastern Standard Time":20261121T150000');
      assert.equal(tzParsed.toISOString(), '2026-11-21T20:00:00.000Z');

      // Verify notes@invite.lalia.cloud recipient check
      assert.equal(hasNotetakerRecipient({ to: ['notes@invite.lalia.cloud'] }), true);

      // Build a future Outlook TZID invite from the connected Outlook email (different from Lalia login email)
      const futureYear = new Date(Date.now() + 72 * 3600 * 1000).getUTCFullYear() + 1;
      const outlookIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        'UID:outlook-event-tz-1@outlook.com',
        `DTSTART;TZID="Eastern Standard Time":${futureYear}0115T100000`,
        'SUMMARY:Outlook Client Review',
        'LOCATION:https://teams.live.com/meet/555666777888?p=xyz',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const invRes = await scheduleNotetakerFromParsedEmail({
        fromEmail: 'Kenneth Outlook <outlook-user@outlook.com>',
        subject: 'Invitation: Outlook Client Review',
        icsTexts: [outlookIcs],
      });
      assert.equal(invRes.ok, true);
      assert.equal(invRes.platform, 'ms_teams');
      assert.equal(invRes.scheduledFor, `${futureYear}-01-15T15:00:00.000Z`);
      assert.equal(recallBotCreates.length, 1);

      // Follow-up METHOD:CANCEL cancels the scheduled bot via Recall DELETE
      const cancelIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'METHOD:CANCEL',
        'BEGIN:VEVENT',
        'UID:outlook-event-tz-1@outlook.com',
        'STATUS:CANCELLED',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const cancelInvRes = await scheduleNotetakerFromParsedEmail({
        fromEmail: 'outlook-user@outlook.com',
        subject: 'Canceled: Outlook Client Review',
        icsTexts: [cancelIcs],
      });
      assert.equal(cancelInvRes.ok, true);
      assert.equal(cancelInvRes.canceled, true);
      assert.equal(recallBotDeletes.length, 1);
    } finally {
      global.fetch = origFetch;
      await fsp.rm(tmpCertDir, { recursive: true, force: true }).catch(() => {});
      if (prevMsClientId === undefined) delete process.env.MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID;
      else process.env.MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID = prevMsClientId;
      if (prevMsCertPem === undefined) delete process.env.MICROSOFT_OUTLOOK_OAUTH_CERT_PEM;
      else process.env.MICROSOFT_OUTLOOK_OAUTH_CERT_PEM = prevMsCertPem;
      if (prevMsKeyPem === undefined) delete process.env.MICROSOFT_OUTLOOK_OAUTH_PRIVATE_KEY_PEM;
      else process.env.MICROSOFT_OUTLOOK_OAUTH_PRIVATE_KEY_PEM = prevMsKeyPem;
      if (prevPublicBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = prevPublicBase;
    }
  });
});
