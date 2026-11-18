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
const notetakerRouter = require('../routes/v2/notetaker');
const botInternalRouter = require('../routes/v2/botInternal');

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
});
