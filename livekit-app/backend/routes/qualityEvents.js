const express = require('express');
const router = express.Router();
const { run, get } = require('../db/v2Database');
const { verifyToken } = require('../lib/authAdapter');
const { verifyMeetingQualityToken } = require('../lib/meetingQualityToken');

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await run(`
    CREATE TABLE IF NOT EXISTS screen_share_quality_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      participant_identity TEXT,
      from_layer TEXT,
      to_layer TEXT,
      ts INTEGER NOT NULL
    )
  `);
  tableReady = true;
}

/** One insert per participant per 30s window (skip-if-duplicate). */
const recentKeys = new Map();
const WINDOW_MS = 30_000;
const MAX_BODY_CHARS = 2048;

async function authorizeQualityEvent(req, meetingId) {
  const qualityHeader =
    req.get('x-meeting-quality-token') ||
    (typeof req.body?.quality_token === 'string' ? req.body.quality_token : '');
  if (qualityHeader) {
    const check = verifyMeetingQualityToken(qualityHeader, meetingId);
    if (check.ok) return { ok: true, via: 'quality_token' };
  }

  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const payload = verifyToken(m[1].trim());
    if (payload?.orgId || payload?.org_id) {
      const orgId = payload.orgId || payload.org_id;
      const meeting = await get(`SELECT id, org_id FROM v2_meetings WHERE id = ?`, [meetingId]);
      if (meeting && meeting.org_id === orgId) {
        return { ok: true, via: 'session_jwt' };
      }
    }
  }

  return { ok: false };
}

router.post('/', async (req, res) => {
  try {
    const rawLen = Number(req.get('content-length') || 0);
    if (rawLen > MAX_BODY_CHARS) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const { meeting_id, participant_identity, from_layer, to_layer } = req.body || {};
    if (!meeting_id || typeof meeting_id !== 'string') {
      return res.status(400).json({ error: 'meeting_id required' });
    }

    const authz = await authorizeQualityEvent(req, meeting_id);
    if (!authz.ok) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const key = `${meeting_id}:${participant_identity}:${from_layer}:${to_layer}`;
    const lastTs = recentKeys.get(key) || 0;
    if (Date.now() - lastTs < WINDOW_MS) {
      return res.json({ ok: true, skipped: true });
    }
    recentKeys.set(key, Date.now());
    if (recentKeys.size > 5000) {
      const cutoff = Date.now() - WINDOW_MS * 2;
      for (const [k, ts] of recentKeys) {
        if (ts < cutoff) recentKeys.delete(k);
      }
    }

    await ensureTable();
    await run(
      `INSERT INTO screen_share_quality_events (meeting_id, participant_identity, from_layer, to_layer, ts)
       VALUES (?, ?, ?, ?, ?)`,
      [
        meeting_id.slice(0, 128),
        participant_identity ? String(participant_identity).slice(0, 256) : null,
        from_layer ? String(from_layer).slice(0, 32) : null,
        to_layer ? String(to_layer).slice(0, 32) : null,
        Date.now(),
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[quality-events] error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
