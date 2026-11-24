const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../../db/v2Database');
const { putOrgObject, objectKey } = require('../../lib/objectStorage');
const {
  ingestBotTranscriptLines,
  finalizeBotSessionAndRunPipeline,
} = require('../../lib/notetakerPipeline');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');

function verifyWorkerAuth(req, res, next) {
  const configured = String(process.env.BOT_WORKER_SECRET || '').trim();
  if (!configured) {
    return res.status(503).json({ error: 'BOT_WORKER_SECRET is not configured on backend' });
  }
  const headerSecret =
    req.headers['x-bot-worker-secret'] ||
    (String(req.headers.authorization || '').startsWith('Bearer ')
      ? String(req.headers.authorization).slice(7).trim()
      : '');
  if (!headerSecret) {
    return res.status(401).json({ error: 'Missing worker credentials' });
  }
  const a = Buffer.from(String(headerSecret));
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid worker credentials' });
  }
  return next();
}

router.use(verifyWorkerAuth);

/**
 * Atomically promotes due scheduled sessions and claims the oldest queued bot session.
 */
router.post('/claim', async (req, res) => {
  try {
    const workerId = String(req.body?.workerId || 'bot-worker-1').trim().slice(0, 120);
    const nowIso = new Date().toISOString();
    // Promote scheduled jobs due within the next 60 seconds
    const leadIso = new Date(Date.now() + 60_000).toISOString();
    // Recover abandoned sessions whose worker stopped heartbeating for >3 minutes
    const staleHeartbeatIso = new Date(Date.now() - 180_000).toISOString();

    const claimed = await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE v2_external_bot_sessions
         SET status = 'queued', updated_at = ?
         WHERE status = 'scheduled'
           AND COALESCE(bot_provider, 'worker') = 'worker'
           AND scheduled_for IS NOT NULL
           AND scheduled_for <= ?`,
        [nowIso, leadIso]
      );

      await tx.run(
        `UPDATE v2_external_bot_sessions
         SET status = 'failed',
             status_detail = 'Worker connection lost during call',
             error_code = 'worker_timeout',
             ended_at = ?,
             updated_at = ?
         WHERE status IN ('joining', 'waiting_in_lobby', 'recording')
           AND COALESCE(bot_provider, 'worker') = 'worker'
           AND heartbeat_at IS NOT NULL
           AND heartbeat_at < ?`,
        [nowIso, nowIso, staleHeartbeatIso]
      );

      const candidate = await tx.get(
        `SELECT * FROM v2_external_bot_sessions
         WHERE status = 'queued'
           AND COALESCE(bot_provider, 'worker') = 'worker'
           AND stop_requested = 0
         ORDER BY COALESCE(scheduled_for, created_at) ASC, created_at ASC
         LIMIT 1`
      );
      if (!candidate) return null;

      const claimToken = crypto.randomUUID();
      const updated = await tx.run(
        `UPDATE v2_external_bot_sessions
         SET status = 'joining',
             status_detail = 'Launching browser & joining meeting…',
             worker_id = ?,
             claim_token = ?,
             heartbeat_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'queued'`,
        [workerId, claimToken, nowIso, nowIso, candidate.id]
      );
      if (!updated.changes) return null;

      await tx.run(
        `UPDATE v2_meetings
         SET status = 'live', started_at = COALESCE(started_at, ?)
         WHERE id = ?`,
        [nowIso, candidate.meeting_id]
      );

      return tx.get(
        `SELECT s.*, m.title AS meeting_title, m.recap_language
         FROM v2_external_bot_sessions s
         JOIN v2_meetings m ON m.id = s.meeting_id
         WHERE s.id = ?`,
        [candidate.id]
      );
    });

    res.json({ session: claimed || null });
  } catch (e) {
    console.error('[bot-internal POST /claim]', e);
    res.status(500).json({ error: 'Failed to claim session' });
  }
});

async function loadClaimedSession(req, res) {
  const session = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [
    req.params.id,
  ]);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  const claimToken = req.headers['x-bot-claim-token'] || req.body?.claimToken;
  if (session.claim_token && claimToken && session.claim_token !== claimToken) {
    res.status(409).json({ error: 'Claim token mismatch' });
    return null;
  }
  return session;
}

router.post('/sessions/:id/heartbeat', async (req, res) => {
  try {
    const session = await loadClaimedSession(req, res);
    if (!session) return;

    const { status, statusDetail, joined } = req.body || {};
    const nowIso = new Date().toISOString();
    const allowedStatuses = new Set(['joining', 'waiting_in_lobby', 'recording', 'processing']);
    const nextStatus = allowedStatuses.has(status) ? status : session.status;
    const nextDetail =
      statusDetail !== undefined ? String(statusDetail || '').slice(0, 300) : session.status_detail;
    const joinedAt =
      joined || nextStatus === 'recording' ? session.joined_at || nowIso : session.joined_at;

    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status = ?,
           status_detail = ?,
           joined_at = ?,
           heartbeat_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [nextStatus, nextDetail, joinedAt, nowIso, nowIso, session.id]
    );

    res.json({
      ok: true,
      stopRequested: Boolean(session.stop_requested),
      status: nextStatus,
    });
  } catch (e) {
    console.error('[bot-internal POST /heartbeat]', e);
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

router.post('/sessions/:id/transcript', async (req, res) => {
  try {
    const session = await loadClaimedSession(req, res);
    if (!session) return;

    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const result = await ingestBotTranscriptLines(session.meeting_id, lines);
    await db.run(`UPDATE v2_external_bot_sessions SET heartbeat_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      session.id,
    ]);
    res.json({ ok: true, ...result, stopRequested: Boolean(session.stop_requested) });
  } catch (e) {
    console.error('[bot-internal POST /transcript]', e);
    res.status(500).json({ error: 'Transcript ingest failed' });
  }
});

router.post(
  '/sessions/:id/recording',
  express.raw({
    type: ['audio/*', 'video/webm', 'application/octet-stream'],
    limit: '300mb',
  }),
  async (req, res) => {
    try {
      const session = await loadClaimedSession(req, res);
      if (!session) return;

      const buf = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buf || buf.length === 0) {
        return res.status(400).json({ error: 'Empty audio recording body' });
      }

      const contentType = String(req.headers['content-type'] || 'audio/mpeg')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const ext = contentType.includes('mp4') || contentType.includes('m4a')
        ? 'm4a'
        : contentType.includes('webm')
          ? 'webm'
          : contentType.includes('ogg') || contentType.includes('opus')
            ? 'ogg'
            : contentType.includes('wav')
              ? 'wav'
              : 'mp3';

      const durationSeconds = req.headers['x-recording-duration-seconds']
        ? Math.max(0, Math.round(Number(req.headers['x-recording-duration-seconds']) || 0))
        : null;

      const recordingId = db.uuid();
      const relativePath = `recordings/${session.meeting_id}-${recordingId.slice(0, 8)}.${ext}`;
      const storageKey = objectKey(session.org_id, relativePath);

      await putOrgObject(session.org_id, relativePath, buf, {
        contentType: contentType || 'audio/mpeg',
      });

      const nowIso = new Date().toISOString();
      await db.run(
        `INSERT INTO v2_meeting_recordings (
          id, org_id, meeting_id, bot_session_id, storage_key, relative_path,
          mime_type, size_bytes, duration_seconds, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          recordingId,
          session.org_id,
          session.meeting_id,
          session.id,
          storageKey,
          relativePath,
          contentType || 'audio/mpeg',
          buf.length,
          durationSeconds,
          nowIso,
        ]
      );

      if (durationSeconds != null && durationSeconds > 0) {
        await db.run(
          `UPDATE v2_external_bot_sessions SET duration_seconds = COALESCE(duration_seconds, ?) WHERE id = ?`,
          [durationSeconds, session.id]
        );
      }

      res.status(201).json({
        ok: true,
        recordingId,
        bytes: buf.length,
        storageKey,
      });
    } catch (e) {
      console.error('[bot-internal POST /recording]', e);
      res.status(500).json({ error: 'Recording upload failed' });
    }
  }
);

router.post('/sessions/:id/complete', async (req, res) => {
  try {
    const session = await loadClaimedSession(req, res);
    if (!session) return;

    const { failed, errorCode, statusDetail, durationSeconds } = req.body || {};
    const nowIso = new Date().toISOString();

    if (failed) {
      await db.run(
        `UPDATE v2_external_bot_sessions
         SET status = 'failed',
             error_code = ?,
             status_detail = ?,
             ended_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [
          String(errorCode || 'bot_error').slice(0, 64),
          String(statusDetail || 'Could not join or record meeting').slice(0, 300),
          nowIso,
          nowIso,
          session.id,
        ]
      );
      await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = ? WHERE id = ?`, [
        nowIso,
        session.meeting_id,
      ]);
      return res.json({ ok: true, status: 'failed' });
    }

    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status = 'processing',
           status_detail = 'Generating AI summary & recap…',
           ended_at = COALESCE(ended_at, ?),
           duration_seconds = COALESCE(?, duration_seconds),
           updated_at = ?
       WHERE id = ?`,
      [
        nowIso,
        Number.isFinite(Number(durationSeconds)) ? Math.round(Number(durationSeconds)) : null,
        nowIso,
        session.id,
      ]
    );

    const baseUrl = publicFrontendBaseUrl(req);
    const pipelineResult = await finalizeBotSessionAndRunPipeline(session.id, {
      publicBaseUrl: baseUrl,
    });

    return res.json({ ok: true, status: 'completed', ...pipelineResult });
  } catch (e) {
    console.error('[bot-internal POST /complete]', e);
    return res.status(500).json({ error: 'Completion pipeline failed' });
  }
});

module.exports = router;
