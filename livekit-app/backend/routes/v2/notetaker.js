const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { parseExternalMeetingUrl } = require('../../lib/externalMeetingUrls');
const { assertCanCreateMeeting } = require('../../lib/v2Entitlements');
const {
  getNotetakerSettings,
  dispatchRecallBotForSession,
  stopRecallBotSession,
} = require('../../lib/recallNotetaker');

const VALID_RECAP_MODES = new Set(['off', 'host_only', 'workspace', 'attendees']);

function sanitizeEmails(rawList) {
  if (!rawList) return [];
  const items = Array.isArray(rawList)
    ? rawList
    : String(rawList)
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const email = String(item || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out.slice(0, 100);
}

router.get('/status', requireV2Auth, async (_req, res) => {
  try {
    const ntSettings = await getNotetakerSettings();
    res.json({
      driver: ntSettings.effectiveDriver,
      ready:
        ntSettings.effectiveDriver === 'recall'
          ? Boolean(ntSettings.recallApiKey)
          : Boolean(process.env.BOT_WORKER_SECRET),
      supportedPlatforms: ['google_meet', 'ms_teams', 'zoom', 'webex'],
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to inspect notetaker status' });
  }
});

router.post('/parse-url', requireV2Auth, (req, res) => {
  const parsed = parseExternalMeetingUrl(req.body?.url || '');
  if (!parsed.ok) {
    return res.status(400).json(parsed);
  }
  return res.json(parsed);
});

router.get('/sessions', requireV2Auth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT s.*, m.title AS meeting_title, m.auto_recap_mode, m.recap_language
       FROM v2_external_bot_sessions s
       JOIN v2_meetings m ON m.id = s.meeting_id
       WHERE s.org_id = ?
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [req.v2Auth.orgId]
    );
    res.json({ sessions: rows });
  } catch (e) {
    console.error('[v2/notetaker GET /sessions]', e);
    res.status(500).json({ error: 'Failed to list notetaker sessions' });
  }
});

router.post('/sessions', requireV2Auth, async (req, res) => {
  try {
    const gate = await assertCanCreateMeeting(req.v2Auth.orgId);
    if (!gate.ok) {
      return res.status(402).json({ error: gate.message, code: gate.code });
    }

    const {
      url,
      title,
      botDisplayName,
      autoRecapMode = 'host_only',
      recapLanguage = '',
      attendeeEmails,
      scheduledFor,
    } = req.body || {};

    const parsed = parseExternalMeetingUrl(url);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    if (!VALID_RECAP_MODES.has(autoRecapMode)) {
      return res.status(400).json({ error: 'Invalid autoRecapMode' });
    }

    const userRow = await db.get(`SELECT display_name, email FROM v2_users WHERE id = ?`, [
      req.v2Auth.userId,
    ]);
    const firstName = (
      userRow?.display_name ||
      userRow?.email?.split('@')[0] ||
      'Lalia'
    )
      .trim()
      .split(/\s+/)[0];

    const resolvedBotName = String(
      botDisplayName && String(botDisplayName).trim()
        ? String(botDisplayName).trim()
        : `${firstName}'s Lalia Notetaker`
    ).slice(0, 80);

    const resolvedTitle = String(
      title && String(title).trim() ? String(title).trim() : parsed.defaultTitle
    ).slice(0, 200);

    let scheduledIso = null;
    let isFutureSchedule = false;
    if (scheduledFor) {
      const d = new Date(scheduledFor);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid scheduledFor timestamp' });
      }
      scheduledIso = d.toISOString();
      isFutureSchedule = d.getTime() > Date.now() + 60_000;
    }

    const emails = sanitizeEmails(attendeeEmails);
    const cleanRecapLang = recapLanguage ? String(recapLanguage).trim().slice(0, 24) : null;
    const nowIso = new Date().toISOString();
    const meetingId = db.uuid();
    const sessionId = db.uuid();
    const placeholderRoomName = `ext-${parsed.platform.replace('_', '-')}-${crypto.randomUUID().slice(0, 12)}`;
    const hostCode = crypto.randomBytes(4).toString('hex');
    const initialMeetingStatus = isFutureSchedule ? 'scheduled' : 'live';
    const initialBotStatus = isFutureSchedule ? 'scheduled' : 'queued';
    const ntSettings = await getNotetakerSettings();
    const useRecall = ntSettings.effectiveDriver === 'recall';
    const botProvider = useRecall ? 'recall' : 'worker';

    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO v2_meetings (
          id, org_id, host_user_id, livekit_room_name, title, status,
          scheduled_start, started_at, host_code, metadata, host_present,
          meeting_source, external_meeting_url, auto_recap_mode, recap_language, attendee_emails_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          meetingId,
          req.v2Auth.orgId,
          req.v2Auth.userId,
          placeholderRoomName,
          resolvedTitle,
          initialMeetingStatus,
          scheduledIso,
          isFutureSchedule ? null : nowIso,
          hostCode,
          JSON.stringify({
            source: 'external_notetaker',
            platform: parsed.platform,
            botSessionId: sessionId,
            botProvider,
          }),
          1,
          parsed.platform,
          parsed.normalizedUrl,
          autoRecapMode,
          cleanRecapLang,
          emails.length ? JSON.stringify(emails) : null,
        ]
      );

      await tx.run(
        `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts)
         VALUES (?,?,?,?)`,
        [meetingId, 0, 1, 1]
      );

      await tx.run(
        `INSERT INTO v2_external_bot_sessions (
          id, org_id, meeting_id, requested_by_user_id, platform,
          target_url, normalized_url, external_meeting_code, bot_display_name,
          bot_provider, status, status_detail, scheduled_for, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          sessionId,
          req.v2Auth.orgId,
          meetingId,
          req.v2Auth.userId,
          parsed.platform,
          String(url).trim().slice(0, 1000),
          parsed.normalizedUrl,
          parsed.externalCode || null,
          resolvedBotName,
          botProvider,
          initialBotStatus,
          isFutureSchedule
            ? `Scheduled to join ${parsed.platformLabel}`
            : `Queued to join ${parsed.platformLabel}…`,
          scheduledIso,
          nowIso,
          nowIso,
        ]
      );
    });

    if (useRecall) {
      const dispatch = await dispatchRecallBotForSession(sessionId);
      const updatedSession = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [sessionId]);
      if (!dispatch.ok) {
        return res.status(502).json({
          error: dispatch.error || 'Failed to dispatch Recall.ai bot',
          meetingId,
          session: updatedSession,
          platform: parsed.platform,
          platformLabel: parsed.platformLabel,
        });
      }
      return res.status(201).json({
        meetingId,
        session: updatedSession,
        platform: parsed.platform,
        platformLabel: parsed.platformLabel,
      });
    }

    const session = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [sessionId]);
    res.status(201).json({
      meetingId,
      session,
      platform: parsed.platform,
      platformLabel: parsed.platformLabel,
    });
  } catch (e) {
    console.error('[v2/notetaker POST /sessions]', e);
    res.status(500).json({ error: 'Failed to dispatch AI Notetaker' });
  }
});

router.get('/sessions/:id', requireV2Auth, async (req, res) => {
  try {
    const session = await db.get(
      `SELECT * FROM v2_external_bot_sessions WHERE id = ? AND org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json({ session });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load session' });
  }
});

router.post('/sessions/:id/stop', requireV2Auth, async (req, res) => {
  try {
    const session = await db.get(
      `SELECT * FROM v2_external_bot_sessions WHERE id = ? AND org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!session) return res.status(404).json({ error: 'Not found' });

    const nowIso = new Date().toISOString();
    if (session.bot_provider === 'recall') {
      await stopRecallBotSession(session);
      const updated = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [session.id]);
      return res.json({ ok: true, session: updated });
    }

    if (session.status === 'queued' || session.status === 'scheduled') {
      await db.run(
        `UPDATE v2_external_bot_sessions
         SET status = 'canceled', stop_requested = 1, status_detail = 'Canceled before joining', ended_at = ?, updated_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, session.id]
      );
      await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = ? WHERE id = ?`, [
        nowIso,
        session.meeting_id,
      ]);
    } else if (!['completed', 'failed', 'canceled'].includes(session.status)) {
      await db.run(
        `UPDATE v2_external_bot_sessions
         SET stop_requested = 1, status_detail = 'Leaving call & saving recording…', updated_at = ?
         WHERE id = ?`,
        [nowIso, session.id]
      );
    }

    const updated = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [session.id]);
    res.json({ ok: true, session: updated });
  } catch (e) {
    console.error('[v2/notetaker POST /stop]', e);
    res.status(500).json({ error: 'Failed to stop notetaker' });
  }
});

module.exports = router;
