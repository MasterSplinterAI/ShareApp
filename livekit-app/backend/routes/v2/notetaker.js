const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { parseExternalMeetingUrl } = require('../../lib/externalMeetingUrls');
const { assertCanCreateMeeting } = require('../../lib/v2Entitlements');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');
const {
  getNotetakerSettings,
  dispatchRecallBotForSession,
  stopRecallBotSession,
} = require('../../lib/recallNotetaker');
const {
  AUTO_JOIN_RULES,
  normalizeAutoJoinRule,
  buildCalendarOAuthForwardRedirect,
  isGoogleCalendarOAuthConfigured,
  isMicrosoftOutlookOAuthConfigured,
  buildCalendarConnectUrl,
  completeLaliaCalendarOAuth,
  syncCalendarEventsFromRecall,
  toggleCalendarEventRecording,
  disconnectRecallCalendar,
} = require('../../lib/recallCalendarV2');
const { getNotetakerInviteEmail } = require('../../lib/inboundNotetakerInvite');

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

router.get('/calendar/oauth/callback', async (req, res) => {
  try {
    if (typeof req.query?.state === 'string' && req.query.state.startsWith('lalia:')) {
      const out = await completeLaliaCalendarOAuth(req.query, {
        publicBaseUrl: publicFrontendBaseUrl(req),
      });
      return res.redirect(302, out.redirectUrl);
    }
    const settings = await getNotetakerSettings();
    const resFwd = buildCalendarOAuthForwardRedirect(req.query || {}, settings);
    if (!resFwd.ok) {
      return res.status(resFwd.status || 400).json({ error: resFwd.error });
    }
    return res.redirect(302, resFwd.redirectUrl);
  } catch (e) {
    console.error('[v2/notetaker GET /calendar/oauth/callback]', e.message);
    return res.status(500).json({ error: 'Calendar callback failed' });
  }
});

router.get('/calendars', requireV2Auth, async (req, res) => {
  try {
    const calendars = await db.all(
      `SELECT id, org_id, user_id, provider, account_email, auto_join_rule,
              recall_calendar_id, status, status_detail, last_synced_at, created_at, updated_at
       FROM v2_calendar_connections
       WHERE org_id = ? AND user_id = ?
       ORDER BY created_at DESC`,
      [req.v2Auth.orgId, req.v2Auth.userId]
    );
    const googleConfigured = isGoogleCalendarOAuthConfigured();
    const outlookConfigured = isMicrosoftOutlookOAuthConfigured();
    res.json({
      calendars,
      oauthConfigured: googleConfigured || outlookConfigured,
      providers: {
        google_calendar: { oauthConfigured: googleConfigured },
        microsoft_outlook: { oauthConfigured: outlookConfigured },
      },
      inviteEmail: getNotetakerInviteEmail(),
    });
  } catch (e) {
    console.error('[v2/notetaker GET /calendars]', e);
    res.status(500).json({ error: 'Failed to load calendar connections' });
  }
});

router.post('/calendars/connect-url', requireV2Auth, (req, res) => {
  try {
    const provider = req.body?.provider || 'google_calendar';
    const out = buildCalendarConnectUrl({
      provider,
      userId: req.v2Auth.userId,
      orgId: req.v2Auth.orgId,
      publicBaseUrl: publicFrontendBaseUrl(req),
    });
    if (!out.ok) {
      return res.status(out.status || 400).json({ error: out.error });
    }
    return res.json({ url: out.url, provider: out.provider });
  } catch (e) {
    console.error('[v2/notetaker POST /calendars/connect-url]', e.message);
    return res.status(500).json({ error: 'Failed to initiate calendar connection' });
  }
});

router.patch('/calendars/:id', requireV2Auth, async (req, res) => {
  try {
    const conn = await db.get(
      `SELECT * FROM v2_calendar_connections WHERE id = ? AND org_id = ? AND user_id = ?`,
      [req.params.id, req.v2Auth.orgId, req.v2Auth.userId]
    );
    if (!conn) return res.status(404).json({ error: 'Calendar connection not found' });

    const rawRule = String(req.body?.autoJoinRule || '').trim().toLowerCase();
    if (!AUTO_JOIN_RULES.has(rawRule)) {
      return res.status(400).json({ error: 'Invalid autoJoinRule' });
    }
    const nextRule = normalizeAutoJoinRule(rawRule, 'manual');
    await db.run(`UPDATE v2_calendar_connections SET auto_join_rule = ?, updated_at = ? WHERE id = ?`, [
      nextRule,
      new Date().toISOString(),
      conn.id,
    ]);

    if (conn.recall_calendar_id && conn.status === 'connected') {
      await syncCalendarEventsFromRecall(conn.recall_calendar_id).catch((err) => {
        console.warn('[v2/notetaker PATCH /calendars] resync warning:', err.message);
      });
    }

    const updated = await db.get(
      `SELECT id, org_id, user_id, provider, account_email, auto_join_rule,
              recall_calendar_id, status, status_detail, last_synced_at, created_at, updated_at
       FROM v2_calendar_connections WHERE id = ?`,
      [conn.id]
    );
    res.json({ ok: true, calendar: updated });
  } catch (e) {
    console.error('[v2/notetaker PATCH /calendars/:id]', e);
    res.status(500).json({ error: 'Failed to update calendar rule' });
  }
});

router.post('/calendars/:id/sync', requireV2Auth, async (req, res) => {
  try {
    const conn = await db.get(
      `SELECT * FROM v2_calendar_connections WHERE id = ? AND org_id = ? AND user_id = ?`,
      [req.params.id, req.v2Auth.orgId, req.v2Auth.userId]
    );
    if (!conn) return res.status(404).json({ error: 'Calendar connection not found' });
    if (!conn.recall_calendar_id) {
      return res.status(400).json({ error: 'Calendar is not linked to a Recall calendar ID' });
    }
    const result = await syncCalendarEventsFromRecall(conn.recall_calendar_id);
    res.json(result);
  } catch (e) {
    console.error('[v2/notetaker POST /calendars/:id/sync]', e);
    res.status(500).json({ error: 'Calendar sync failed' });
  }
});

router.delete('/calendars/:id', requireV2Auth, async (req, res) => {
  try {
    const result = await disconnectRecallCalendar(req.params.id, {
      orgId: req.v2Auth.orgId,
      userId: req.v2Auth.userId,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[v2/notetaker DELETE /calendars/:id]', e);
    res.status(500).json({ error: 'Failed to disconnect calendar' });
  }
});

router.get('/calendar-events', requireV2Auth, async (req, res) => {
  try {
    const events = await db.all(
      `SELECT e.id, e.calendar_connection_id, e.recall_event_id, e.recall_calendar_id,
              e.platform, e.title, e.start_time, e.end_time, e.meeting_url,
              e.normalized_meeting_url, e.meeting_platform, e.organizer_email,
              e.recording_override, e.scheduled_bot_id, e.bot_session_id, e.meeting_id,
              c.auto_join_rule, s.status AS bot_status, s.status_detail AS bot_status_detail
       FROM v2_calendar_events e
       JOIN v2_calendar_connections c ON c.id = e.calendar_connection_id
       LEFT JOIN v2_external_bot_sessions s ON s.id = e.bot_session_id
       WHERE e.org_id = ? AND e.user_id = ? AND e.is_deleted = 0
         AND e.end_time >= ?
       ORDER BY e.start_time ASC
       LIMIT 100`,
      [req.v2Auth.orgId, req.v2Auth.userId, new Date(Date.now() - 3600_000).toISOString()]
    );
    res.json({ events });
  } catch (e) {
    console.error('[v2/notetaker GET /calendar-events]', e);
    res.status(500).json({ error: 'Failed to list calendar events' });
  }
});

router.post('/calendar-events/:id/toggle', requireV2Auth, async (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const result = await toggleCalendarEventRecording(req.params.id, {
      orgId: req.v2Auth.orgId,
      userId: req.v2Auth.userId,
      enabled,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ ok: true, event: result.event });
  } catch (e) {
    console.error('[v2/notetaker POST /calendar-events/:id/toggle]', e);
    res.status(500).json({ error: 'Failed to update calendar recording toggle' });
  }
});

module.exports = router;
