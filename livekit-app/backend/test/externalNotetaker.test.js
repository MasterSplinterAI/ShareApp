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
  hasNotetakerRecipient,
  scheduleNotetakerFromParsedEmail,
} = require('../lib/inboundNotetakerInvite');
const {
  getNotetakerSettings,
  saveNotetakerSettings,
  toNotetakerAdminView,
  verifyRecallCredentials,
} = require('../lib/recallNotetaker');
const { handleRecallWebhook } = require('../routes/v2/recallWebhook');
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

  it('encrypts Recall settings, auto-detects Recall region, runs webhook + xAI STT fallback + COGS rollup, and isolates worker queue', async () => {
    const rawWhKey = crypto.randomBytes(24).toString('base64');
    const webhookSecret = `whsec_${rawWhKey}`;
    const apiKey = 'recall_test_api_key_9876543210';

    // 1. Save encrypted Recall credentials
    const saved = await saveNotetakerSettings('kenny@lalia.cloud', {
      driverMode: 'auto',
      recallRegion: 'us-east-1',
      recallApiKey: apiKey,
      recallWebhookSecret: webhookSecret,
      transcriptMode: 'meeting_captions',
      xaiFallbackEnabled: true,
      reason: 'Enable Recall.ai in test suite',
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.settings.effectiveDriver, 'recall');

    const adminView = toNotetakerAdminView(saved.settings, { publicBaseUrl: 'https://lalia.cloud' });
    assert.equal(adminView.hasRecallApiKey, true);
    assert.ok(!adminView.recallApiKeyMasked.includes('9876543210'));
    assert.equal(adminView.webhookUrl, 'https://lalia.cloud/api/v2/webhooks/recall');

    // 2. Verify region auto-detection across Recall regions
    const verifyRes = await verifyRecallCredentials(
      { apiKey, region: 'us-east-1' },
      {
        fetchImpl: async (url) => {
          if (url.startsWith('https://us-east-1.recall.ai')) return { ok: false, status: 401 };
          if (url.startsWith('https://us-west-2.recall.ai')) return { ok: true, status: 200 };
          return { ok: false, status: 401 };
        },
      }
    );
    assert.equal(verifyRes.ok, true);
    assert.equal(verifyRes.region, 'us-west-2');
    assert.equal(verifyRes.regionAutoDetected, true);

    // Update DB region to us-east-1 explicitly and enable xAI fallback key
    process.env.XAI_API_KEY = 'xai-test-key-for-stt-fallback';

    // Mock global fetch for Recall dispatch -> webhook GET bot -> S3 download -> xAI STT fallback
    const origFetch = global.fetch;
    const fakeAudioBytes = Buffer.alloc(2048, 0x41);
    const createdBotId = 'rec-bot-1111-2222';
    let botPhase = 'joining_call';
    let transcriptPayload = []; // Empty native captions -> triggers xAI STT fallback
    let xaiMultipartSawFileLast = false;

    global.fetch = async (url, init = {}) => {
      const urlStr = String(url);
      if (urlStr === 'https://us-east-1.recall.ai/api/v1/bot/' && init.method === 'POST') {
        assert.equal(init.headers.Authorization, `Token ${apiKey}`);
        const sent = JSON.parse(init.body);
        assert.ok(sent.meeting_url.includes('zoom.us/j/44455566677'));
        assert.deepEqual(sent.recording_config.transcript.provider, { meeting_captions: {} });
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: createdBotId, status_changes: [{ code: 'joining_call' }] }),
        };
      }

      if (urlStr === `https://us-east-1.recall.ai/api/v1/bot/${createdBotId}/` && (!init.method || init.method === 'GET')) {
        assert.equal(init.headers.Authorization, `Token ${apiKey}`);
        if (botPhase === 'in_waiting_room') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: createdBotId,
              status_changes: [{ code: 'joining_call' }, { code: 'in_waiting_room' }],
            }),
          };
        }
        if (botPhase === 'done') {
          const t0 = '2026-11-20T12:00:00.000Z';
          const t1 = '2026-11-20T12:02:00.000Z';
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: createdBotId,
              status_changes: [
                { code: 'in_call_recording', created_at: t0 },
                { code: 'call_ended', created_at: t1 },
                { code: 'done', created_at: t1 },
              ],
              recordings: [
                {
                  id: 'rec-rec-1',
                  media_shortcuts: {
                    audio_mixed: {
                      status: { code: 'done' },
                      data: { download_url: 'https://recall-artifacts.example.com/audio.mp3?sig=1' },
                    },
                    transcript: {
                      status: { code: 'done' },
                      data: { download_url: 'https://recall-artifacts.example.com/transcript.json?sig=1' },
                    },
                  },
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ id: createdBotId, status_changes: [{ code: botPhase }] }) };
      }

      if (urlStr.startsWith('https://recall-artifacts.example.com/audio.mp3')) {
        assert.equal(init.headers?.Authorization, undefined);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => fakeAudioBytes,
        };
      }

      if (urlStr.startsWith('https://recall-artifacts.example.com/transcript.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => transcriptPayload,
        };
      }

      if (urlStr === 'https://api.x.ai/v1/stt') {
        const keys = [...init.body.keys()];
        xaiMultipartSawFileLast = keys[0] === 'model' && keys[1] === 'diarize' && keys[2] === 'file';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Hello everyone. Welcome to Lalia.',
            language: 'en',
            duration: 120,
            words: [
              { text: 'Hello', start: 0.1, end: 0.3, speaker: 0 },
              { text: 'everyone.', start: 0.4, end: 0.7, speaker: 0 },
              { text: 'Welcome.', start: 1.0, end: 1.5, speaker: 1 },
            ],
          }),
        };
      }

      if (urlStr.endsWith('/delete_media/')) {
        return { ok: true, status: 204 };
      }

      throw new Error(`Unexpected fetch in test: ${urlStr}`);
    };

    try {
      // 3. Dispatch Zoom call through API router
      const dispatchRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: '/sessions',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          url: 'https://zoom.us/j/44455566677?pwd=xyz',
          title: 'Recall E2E Test',
          autoRecapMode: 'off',
        },
      });
      assert.equal(dispatchRes.status, 201);
      assert.equal(dispatchRes.body.platform, 'zoom');
      assert.equal(dispatchRes.body.session.bot_provider, 'recall');
      assert.equal(dispatchRes.body.session.external_bot_id, createdBotId);
      const recallSessionId = dispatchRes.body.session.id;
      const recallMeetingId = dispatchRes.body.meetingId;

      // 4. Self-hosted worker /claim ignores Recall sessions
      const workerClaim = await invokeRouter(botInternalRouter, {
        method: 'POST',
        url: '/claim',
        headers: { 'x-bot-worker-secret': process.env.BOT_WORKER_SECRET },
        body: { workerId: 'worker-test-ignore' },
      });
      assert.equal(workerClaim.status, 200);
      assert.equal(workerClaim.body.session, null);

      const signSvix = (msgId, payloadStr) => {
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = crypto
          .createHmac('sha256', Buffer.from(rawWhKey, 'base64'))
          .update(`${msgId}.${ts}.${payloadStr}`)
          .digest('base64');
        return {
          'svix-id': msgId,
          'svix-timestamp': ts,
          'svix-signature': `v1,${sig}`,
        };
      };

      const callWebhook = async (rawText, headers) => {
        return new Promise((resolve) => {
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
      };

      // Invalid webhook signature is rejected with 401
      const badBody = JSON.stringify({ event: 'bot.in_waiting_room', data: { bot: { id: createdBotId } } });
      const badWh = await callWebhook(badBody, {
        'svix-id': 'msg_bad',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,invalid',
      });
      assert.equal(badWh.status, 401);

      // 5. Valid Svix webhook moves session -> waiting_in_lobby
      botPhase = 'in_waiting_room';
      const lobbyWh = await callWebhook(badBody, signSvix('msg_lobby', badBody));
      assert.equal(lobbyWh.status, 200);
      assert.equal(lobbyWh.body.synced, true);
      const midSession = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [recallSessionId]);
      assert.equal(midSession.status, 'waiting_in_lobby');

      // 6. Valid Svix webhook on bot.done triggers MP3 ingest + xAI STT fallback + COGS + completion
      botPhase = 'done';
      const doneBody = JSON.stringify({ event: 'bot.done', data: { bot: { id: createdBotId } } });
      const doneWh = await callWebhook(doneBody, signSvix('msg_done', doneBody));
      assert.equal(doneWh.status, 200);
      assert.equal(doneWh.body.synced, true);
      assert.equal(xaiMultipartSawFileLast, true);

      const finalSession = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [recallSessionId]);
      assert.equal(finalSession.status, 'completed');
      assert.equal(finalSession.duration_seconds, 120);
      assert.ok(finalSession.ingested_at);

      const recRow = await db.get(`SELECT * FROM v2_meeting_recordings WHERE bot_session_id = ?`, [recallSessionId]);
      assert.ok(recRow);
      assert.equal(recRow.size_bytes, fakeAudioBytes.length);

      const lines = await db.all(
        `SELECT * FROM v2_meeting_transcript_lines WHERE meeting_id = ? ORDER BY recorded_at ASC`,
        [recallMeetingId]
      );
      assert.equal(lines.length, 2);
      assert.equal(lines[0].participant_identity, 'Speaker 1');
      assert.equal(lines[0].original_text, 'Hello everyone.');

      const meetingRow = await db.get(`SELECT * FROM v2_meetings WHERE id = ?`, [recallMeetingId]);
      const costRows = await db.all(
        `SELECT * FROM meeting_cost_events WHERE meeting_id = ? ORDER BY id ASC`,
        [meetingRow.livekit_room_name]
      );
      assert.equal(costRows.length, 2);
      assert.equal(costRows[0].event_type, 'recall_bot_minute');
      assert.equal(costRows[1].event_type, 'xai_stt_minute');

      const rollupRow = await db.get(
        `SELECT * FROM meeting_cost_rollups WHERE meeting_id = ?`,
        [meetingRow.livekit_room_name]
      );
      assert.ok(rollupRow);
      assert.ok(rollupRow.total_cost_usd > 0.01);
    } finally {
      global.fetch = origFetch;
      delete process.env.XAI_API_KEY;
    }
  });

  it('ingests native Recall meeting_captions without xAI fallback, stops scheduled vs active Recall bots, and serves superadmin /notetaker/* routes', async () => {
    const prevSuperadmins = process.env.V2_SUPERADMIN_EMAILS;
    const origFetch = global.fetch;
    process.env.V2_SUPERADMIN_EMAILS = 'kenneth@example.com';
    process.env.XAI_API_KEY = 'xai-should-not-be-called-for-native-captions';

    const apiKey = 'recall_native_captions_key_123456';
    const patchAdminRes = await invokeRouter(adminRouter, {
      method: 'PATCH',
      url: '/notetaker/config',
      headers: { Authorization: `Bearer ${userToken}` },
      body: {
        driverMode: 'recall',
        recallRegion: 'us-east-1',
        recallApiKey: apiKey,
        clearRecallWebhookSecret: true,
        transcriptMode: 'meeting_captions',
        reason: 'Test native captions and admin routes',
      },
    });
    assert.equal(patchAdminRes.status, 200);
    assert.equal(patchAdminRes.body.ok, true);
    assert.equal(patchAdminRes.body.settings.effectiveDriver, 'recall');

    const getAdminRes = await invokeRouter(adminRouter, {
      method: 'GET',
      url: '/notetaker/config',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(getAdminRes.status, 200);
    assert.equal(getAdminRes.body.settings.hasRecallApiKey, true);

    const statusRes = await invokeRouter(notetakerRouter, {
      method: 'GET',
      url: '/status',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.driver, 'recall');
    assert.equal(statusRes.body.ready, true);
    assert.ok(statusRes.body.supportedPlatforms.includes('zoom'));
    assert.ok(statusRes.body.supportedPlatforms.includes('webex'));

    let nextBotNum = 1;
    const deletedBots = [];
    const leaveCallBots = [];
    let xaiCalled = false;

    global.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u === 'https://us-east-1.recall.ai/api/v1/bot/?limit=1') {
        return { ok: true, status: 200, json: async () => ({ results: [] }) };
      }
      if (u === 'https://us-east-1.recall.ai/api/v1/bot/' && init.method === 'POST') {
        const botId = `rec-native-${nextBotNum++}`;
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: botId, status_changes: [{ code: 'joining_call' }] }),
        };
      }
      if (u.startsWith('https://us-east-1.recall.ai/api/v1/bot/') && init.method === 'DELETE') {
        deletedBots.push(u);
        return { ok: true, status: 204 };
      }
      if (u.endsWith('/leave_call/') && init.method === 'POST') {
        leaveCallBots.push(u);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (u.startsWith('https://us-east-1.recall.ai/api/v1/bot/rec-native-2/') && (!init.method || init.method === 'GET')) {
        const t0 = '2026-11-20T13:00:00.000Z';
        const t1 = '2026-11-20T13:01:00.000Z';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'rec-native-2',
            status_changes: [
              { code: 'in_call_recording', created_at: t0 },
              { code: 'done', created_at: t1 },
            ],
            recordings: [
              {
                id: 'rec-n2',
                media_shortcuts: {
                  audio_mixed: {
                    status: 'done',
                    data: { download_url: 'https://recall-artifacts.example.com/native2.mp3' },
                  },
                  transcript: {
                    status: 'done',
                    data: { download_url: 'https://recall-artifacts.example.com/native2.json' },
                  },
                },
              },
            ],
          }),
        };
      }
      if (u === 'https://recall-artifacts.example.com/native2.mp3') {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(1024, 0x42) };
      }
      if (u === 'https://recall-artifacts.example.com/native2.json') {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              participant: { name: 'Alice Host' },
              words: [
                { text: 'Quarterly', start_timestamp: { relative: 2.0 } },
                { text: 'review', start_timestamp: { relative: 2.4 } },
              ],
            },
            {
              participant: { name: "Kenneth's Lalia Notetaker" },
              text: 'Bot self audio should be skipped',
            },
          ],
        };
      }
      if (u === 'https://api.x.ai/v1/stt') {
        xaiCalled = true;
        return { ok: true, status: 200, json: async () => ({ text: 'unexpected', words: [] }) };
      }
      if (u.endsWith('/delete_media/')) {
        return { ok: true, status: 204 };
      }
      throw new Error(`Unexpected fetch in native-captions test: ${u}`);
    };

    try {
      const verifyAdminRes = await invokeRouter(adminRouter, {
        method: 'POST',
        url: '/notetaker/verify',
        headers: { Authorization: `Bearer ${userToken}` },
        body: { recallRegion: 'us-east-1' },
      });
      assert.equal(verifyAdminRes.status, 200);
      assert.equal(verifyAdminRes.body.ok, true);

      // Scheduled bot -> stop triggers DELETE
      const futureIso = new Date(Date.now() + 3600_000).toISOString();
      const schedRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: '/sessions',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          url: 'https://acme.webex.com/meet/exec-sync',
          scheduledFor: futureIso,
          autoRecapMode: 'off',
        },
      });
      assert.equal(schedRes.status, 201);
      assert.equal(schedRes.body.session.status, 'scheduled');

      const cancelRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: `/sessions/${schedRes.body.session.id}/stop`,
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(cancelRes.status, 200);
      assert.equal(cancelRes.body.session.status, 'canceled');
      assert.equal(deletedBots.length, 1);

      // Active bot -> stop triggers leave_call/, then bot.done uses native captions without xAI fallback
      const liveRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: '/sessions',
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          url: 'https://meet.google.com/aaa-bbbb-ccc',
          autoRecapMode: 'off',
        },
      });
      assert.equal(liveRes.status, 201);
      const liveSessionId = liveRes.body.session.id;
      const liveMeetingId = liveRes.body.meetingId;

      const leaveRes = await invokeRouter(notetakerRouter, {
        method: 'POST',
        url: `/sessions/${liveSessionId}/stop`,
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(leaveRes.status, 200);
      assert.equal(leaveRes.body.session.stop_requested, 1);
      assert.equal(leaveCallBots.length, 1);

      const whRes = await new Promise((resolve) => {
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
        handleRecallWebhook(
          {
            headers: {},
            body: Buffer.from(JSON.stringify({ event: 'bot.done', data: { bot: { id: 'rec-native-2' } } })),
          },
          res
        );
      });
      assert.equal(whRes.status, 200);
      assert.equal(xaiCalled, false);

      const nativeLines = await db.all(
        `SELECT participant_identity, original_text FROM v2_meeting_transcript_lines WHERE meeting_id = ?`,
        [liveMeetingId]
      );
      assert.equal(nativeLines.length, 1);
      assert.equal(nativeLines[0].participant_identity, 'Alice Host');
      assert.equal(nativeLines[0].original_text, 'Quarterly review');

      const meetingRow = await db.get(`SELECT livekit_room_name FROM v2_meetings WHERE id = ?`, [liveMeetingId]);
      const costRows = await db.all(
        `SELECT event_type FROM meeting_cost_events WHERE meeting_id = ?`,
        [meetingRow.livekit_room_name]
      );
      assert.deepEqual(
        costRows.map((r) => r.event_type),
        ['recall_bot_minute']
      );
    } finally {
      global.fetch = origFetch;
      delete process.env.XAI_API_KEY;
      if (prevSuperadmins === undefined) delete process.env.V2_SUPERADMIN_EMAILS;
      else process.env.V2_SUPERADMIN_EMAILS = prevSuperadmins;
    }
  });
});
