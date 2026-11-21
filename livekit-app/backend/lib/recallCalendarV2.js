'use strict';

/**
 * Recall.ai Calendar V2 integration:
 * - Customer-owned OAuth callback forwarding & probe validation
 * - Calendar connection sync & user mapping
 * - Explicit recording opt-in rules ('manual', 'organizer_only', 'all_with_link') + per-event override
 * - Idempotent Schedule / Delete Bot for Calendar Event with deduplication_key
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/v2Database');
const { parseExternalMeetingUrl, platformDisplayName } = require('./externalMeetingUrls');
const {
  getNotetakerSettings,
  fetchWithRecallRetry,
  buildRecallBotPayload,
  recallApiBase,
} = require('./recallNotetaker');

const AUTO_JOIN_RULES = new Set(['manual', 'organizer_only', 'all_with_link']);

function normalizeAutoJoinRule(raw, fallback = 'manual') {
  const s = String(raw || '').trim().toLowerCase();
  return AUTO_JOIN_RULES.has(s) ? s : fallback;
}

/**
 * Validates and builds the forward redirect URL for the customer-owned Calendar OAuth callback.
 * Accepts `state` plus exact one of `code`, `error`, or `recall_calendar_setup_probe=1`.
 * Never logs query values, codes, tokens, or signed state.
 */
function buildCalendarOAuthForwardRedirect(query = {}, settings = {}) {
  const state = typeof query.state === 'string' ? query.state.trim() : '';
  const code = typeof query.code === 'string' && query.code.trim() ? query.code.trim() : null;
  const error = typeof query.error === 'string' && query.error.trim() ? query.error.trim() : null;
  const probeRaw = query.recall_calendar_setup_probe;
  const hasProbe = probeRaw !== undefined && probeRaw !== null && String(probeRaw).trim() !== '';

  const presentCount = (code ? 1 : 0) + (error ? 1 : 0) + (hasProbe ? 1 : 0);
  if (!state || presentCount !== 1) {
    return {
      ok: false,
      status: 400,
      error: 'Expected state and exactly one of code, error, or recall_calendar_setup_probe.',
    };
  }
  if (hasProbe && String(probeRaw).trim() !== '1') {
    return {
      ok: false,
      status: 400,
      error: 'Invalid calendar setup probe value.',
    };
  }

  const regionalUri =
    settings.calendarRegionalCallbackUri ||
    process.env.RECALL_CALENDAR_REGIONAL_CALLBACK_URI ||
    `https://${settings.recallRegion || 'us-west-2'}.recall.ai/api/v1/calendar/google_oauth_callback/`;

  let target;
  try {
    target = new URL(regionalUri);
  } catch {
    return { ok: false, status: 500, error: 'Calendar callback target is misconfigured.' };
  }

  target.searchParams.set('state', state);
  if (code) target.searchParams.set('code', code);
  if (error) target.searchParams.set('error', error);
  if (hasProbe) target.searchParams.set('recall_calendar_setup_probe', '1');

  return { ok: true, redirectUrl: target.toString() };
}

function getGoogleCalendarOAuthClientConfig() {
  const clientId = String(process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET || '').trim();
  const jwtSecret = String(process.env.JWT_SECRET_V2 || '').trim();
  return { clientId, clientSecret, jwtSecret };
}

function isGoogleCalendarOAuthConfigured() {
  const { clientId, clientSecret, jwtSecret } = getGoogleCalendarOAuthClientConfig();
  return Boolean(clientId && clientSecret && jwtSecret);
}

function mintCalendarOAuthState({ userId, orgId }) {
  const { jwtSecret } = getGoogleCalendarOAuthClientConfig();
  if (!jwtSecret) {
    throw new Error('JWT_SECRET_V2 is required for Calendar OAuth state signing');
  }
  const token = jwt.sign(
    { purpose: 'recall_calendar_oauth', userId: String(userId), orgId: String(orgId) },
    jwtSecret,
    { expiresIn: '15m' }
  );
  return `lalia:${token}`;
}

function verifyCalendarOAuthState(rawState) {
  const raw = typeof rawState === 'string' ? rawState.trim() : '';
  if (!raw.startsWith('lalia:')) return null;
  const token = raw.slice('lalia:'.length);
  const { jwtSecret } = getGoogleCalendarOAuthClientConfig();
  if (!token || !jwtSecret) return null;
  try {
    const payload = jwt.verify(token, jwtSecret);
    if (payload?.purpose !== 'recall_calendar_oauth' || !payload.userId || !payload.orgId) {
      return null;
    }
    return { userId: String(payload.userId), orgId: String(payload.orgId) };
  } catch {
    return null;
  }
}

function normalizeBaseUrl(raw) {
  return String(
    process.env.PUBLIC_API_BASE_URL ||
      raw ||
      process.env.PUBLIC_FRONTEND_BASE_URL ||
      process.env.FRONTEND_URL ||
      'https://lalia.cloud'
  )
    .trim()
    .replace(/\/+$/, '');
}

function buildGoogleCalendarConnectUrl({ userId, orgId, publicBaseUrl } = {}) {
  if (!isGoogleCalendarOAuthConfigured()) {
    return { ok: false, status: 503, error: 'Google Calendar OAuth is not configured on this server.' };
  }
  if (!userId || !orgId) {
    return { ok: false, status: 400, error: 'Authenticated user and workspace required.' };
  }
  const { clientId } = getGoogleCalendarOAuthClientConfig();
  const baseUrl = normalizeBaseUrl(publicBaseUrl);
  const redirectUri = `${baseUrl}/api/v2/notetaker/calendar/oauth/callback`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set(
    'scope',
    'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/userinfo.email'
  );
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'select_account consent');
  authUrl.searchParams.set('include_granted_scopes', 'false');
  authUrl.searchParams.set('state', mintCalendarOAuthState({ userId, orgId }));
  return { ok: true, url: authUrl.toString() };
}

async function completeLaliaGoogleCalendarOAuth(
  query = {},
  { publicBaseUrl, fetchImpl = global.fetch, retryOptions } = {}
) {
  const baseUrl = normalizeBaseUrl(publicBaseUrl);
  const failRedirect = (reason) => ({
    ok: true,
    redirectUrl: `${baseUrl}/v2/app/meetings?calendar_error=${encodeURIComponent(reason)}`,
  });

  const verified = verifyCalendarOAuthState(query.state);
  if (!verified) {
    return failRedirect('invalid_or_expired_state');
  }
  if (query.error || !query.code) {
    return failRedirect('oauth_canceled_or_expired');
  }

  const { clientId, clientSecret } = getGoogleCalendarOAuthClientConfig();
  if (!clientId || !clientSecret) {
    return failRedirect('oauth_not_configured');
  }

  const settings = await getNotetakerSettings();
  if (!settings.recallApiKey) {
    return failRedirect('recall_not_configured');
  }

  const redirectUri = `${baseUrl}/api/v2/notetaker/calendar/oauth/callback`;
  const form = new URLSearchParams({
    code: String(query.code).trim(),
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) {
    return failRedirect('token_exchange_failed');
  }
  const tokenJson = await tokenRes.json().catch(() => null);
  const refreshToken = String(tokenJson?.refresh_token || '').trim();
  if (!refreshToken) {
    return failRedirect('missing_refresh_token');
  }

  const recallRes = await fetchWithRecallRetry(
    `${recallApiBase(settings.recallRegion, 'v2')}/calendars/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${settings.recallApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'google_calendar',
        oauth_client_id: clientId,
        oauth_client_secret: clientSecret,
        oauth_refresh_token: refreshToken,
        metadata: {
          lalia_user_id: verified.userId,
          lalia_org_id: verified.orgId,
        },
      }),
    },
    { fetchImpl, retryNetwork: false, ...retryOptions }
  );
  if (!recallRes.ok) {
    return failRedirect('recall_connect_failed');
  }

  const calData = await recallRes.json();
  await resolveConnectionForRecallCalendar(calData);
  if (calData?.id) {
    await syncCalendarEventsFromRecall(calData.id, { fetchImpl, retryOptions }).catch(() => {});
  }
  return { ok: true, redirectUrl: `${baseUrl}/v2/app/meetings?calendar=connected` };
}

function extractOrganizerEmail(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.organizer?.email) return String(raw.organizer.email).trim().toLowerCase();
  if (raw.organizer?.emailAddress?.address) {
    return String(raw.organizer.emailAddress.address).trim().toLowerCase();
  }
  return null;
}

function extractEventTitle(raw, parsedUrl, calEvent) {
  const title = raw?.summary || raw?.subject || calEvent?.title || parsedUrl?.defaultTitle || 'Calendar Meeting';
  return String(title).trim().slice(0, 200);
}

function extractMeetingInfoFromRecallEvent(calEvent) {
  const raw = calEvent?.raw && typeof calEvent.raw === 'object' ? calEvent.raw : {};
  const candidates = [calEvent?.meeting_url, raw.hangoutLink];

  if (Array.isArray(raw.conferenceData?.entryPoints)) {
    for (const ep of raw.conferenceData.entryPoints) {
      if (ep?.uri) candidates.push(ep.uri);
    }
  }
  candidates.push(raw.onlineMeetingUrl, raw.onlineMeeting?.joinUrl, raw.location, raw.description, raw.body?.content);

  for (const cand of candidates) {
    if (!cand) continue;
    const parsed = parseExternalMeetingUrl(String(cand));
    if (parsed.ok) return parsed;
  }
  return null;
}

/**
 * Evaluates whether a calendar event should have a bot scheduled under Lalia's opt-in policy.
 */
function evaluateCalendarEventOptIn(eventRow, calendarConn, { nowMs = Date.now() } = {}) {
  if (!eventRow || eventRow.is_deleted) {
    return { eligible: false, shouldRecord: false, reason: 'event_deleted' };
  }
  const endMs = eventRow.end_time ? new Date(eventRow.end_time).getTime() : NaN;
  if (!Number.isFinite(endMs) || endMs <= nowMs) {
    return { eligible: false, shouldRecord: false, reason: 'event_ended' };
  }
  if (!eventRow.normalized_meeting_url) {
    return { eligible: false, shouldRecord: false, reason: 'no_supported_meeting_url' };
  }

  if (eventRow.recording_override === 'enabled') {
    return { eligible: true, shouldRecord: true, reason: 'manual_opt_in' };
  }
  if (eventRow.recording_override === 'disabled') {
    return { eligible: true, shouldRecord: false, reason: 'manual_opt_out' };
  }

  const rule = normalizeAutoJoinRule(calendarConn?.auto_join_rule, 'manual');
  if (rule === 'all_with_link') {
    return { eligible: true, shouldRecord: true, reason: 'all_with_link' };
  }
  if (rule === 'organizer_only') {
    const orgEmail = String(eventRow.organizer_email || '').trim().toLowerCase();
    const acctEmail = String(calendarConn?.account_email || '').trim().toLowerCase();
    const match = Boolean(orgEmail && acctEmail && orgEmail === acctEmail);
    return {
      eligible: true,
      shouldRecord: match,
      reason: match ? 'organizer_match' : 'not_organizer',
    };
  }
  return { eligible: true, shouldRecord: false, reason: 'awaiting_opt_in' };
}

async function resolveConnectionForRecallCalendar(calData) {
  const recallCalId = String(calData?.id || '').trim();
  if (!recallCalId) return null;

  let conn = await db.get(`SELECT * FROM v2_calendar_connections WHERE recall_calendar_id = ? LIMIT 1`, [
    recallCalId,
  ]);
  const platform = String(calData?.platform || 'google_calendar');
  const accountEmail = String(calData?.platform_email || calData?.oauth_email || '').trim().toLowerCase();
  const status = String(calData?.status || 'connected').toLowerCase();
  const nowIso = new Date().toISOString();

  if (conn) {
    await db.run(
      `UPDATE v2_calendar_connections
       SET account_email = COALESCE(NULLIF(?, ''), account_email),
           status = ?,
           status_detail = ?,
           updated_at = ?
       WHERE id = ?`,
      [accountEmail, status, calData?.status_changes?.slice(-1)?.[0]?.code || status, nowIso, conn.id]
    );
    return db.get(`SELECT * FROM v2_calendar_connections WHERE id = ?`, [conn.id]);
  }

  // Try matching by metadata user/org first, then by Lalia user email === platform_email
  let userRow = null;
  const metaUserId = calData?.metadata?.lalia_user_id;
  if (metaUserId) {
    userRow = await db.get(`SELECT id, email FROM v2_users WHERE id = ? AND disabled_at IS NULL LIMIT 1`, [
      String(metaUserId),
    ]);
  }
  if (!userRow && accountEmail) {
    userRow = await db.get(
      `SELECT id, email FROM v2_users WHERE LOWER(email) = LOWER(?) AND disabled_at IS NULL LIMIT 1`,
      [accountEmail]
    );
  }
  if (!userRow) return null;

  let orgId = calData?.metadata?.lalia_org_id || null;
  if (!orgId) {
    const member = await db.get(
      `SELECT org_id FROM v2_org_members WHERE user_id = ?
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END ASC LIMIT 1`,
      [userRow.id]
    );
    orgId = member?.org_id || null;
  }
  if (!orgId) return null;

  const existingEmailRow = await db.get(
    `SELECT * FROM v2_calendar_connections WHERE user_id = ? AND provider = ? AND LOWER(account_email) = LOWER(?) LIMIT 1`,
    [userRow.id, platform, accountEmail || userRow.email]
  );
  if (existingEmailRow) {
    await db.run(
      `UPDATE v2_calendar_connections
       SET recall_calendar_id = ?, status = ?, status_detail = ?, updated_at = ?
       WHERE id = ?`,
      [recallCalId, status, status, nowIso, existingEmailRow.id]
    );
    return db.get(`SELECT * FROM v2_calendar_connections WHERE id = ?`, [existingEmailRow.id]);
  }

  const connId = db.uuid();
  await db.run(
    `INSERT INTO v2_calendar_connections (
      id, org_id, user_id, provider, account_email, auto_join_rule,
      recall_calendar_id, status, status_detail, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      connId,
      orgId,
      userRow.id,
      platform,
      accountEmail || userRow.email,
      'manual',
      recallCalId,
      status,
      status,
      nowIso,
      nowIso,
    ]
  );
  return db.get(`SELECT * FROM v2_calendar_connections WHERE id = ?`, [connId]);
}

async function handleCalendarUpdateWebhook(recallCalendarId, { fetchImpl = global.fetch, retryOptions } = {}) {
  const settings = await getNotetakerSettings();
  if (!settings.recallApiKey) return { ok: false, error: 'Recall API key missing' };

  const res = await fetchWithRecallRetry(
    `${recallApiBase(settings.recallRegion, 'v2')}/calendars/${encodeURIComponent(recallCalendarId)}/`,
    {
      method: 'GET',
      headers: { Authorization: `Token ${settings.recallApiKey}` },
    },
    { fetchImpl, retryNetwork: true, ...retryOptions }
  );
  if (!res.ok) return { ok: false, error: `Retrieve Calendar HTTP ${res.status}` };

  const calData = await res.json();
  const conn = await resolveConnectionForRecallCalendar(calData);

  if (conn && String(calData?.status || '').toLowerCase() === 'disconnected') {
    const nowIso = new Date().toISOString();
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status = 'canceled', status_detail = 'Calendar disconnected', ended_at = ?, updated_at = ?
       WHERE calendar_event_id IN (SELECT id FROM v2_calendar_events WHERE calendar_connection_id = ?)
         AND status IN ('scheduled', 'queued')`,
      [nowIso, nowIso, conn.id]
    );
  }

  return { ok: true, calendarId: recallCalendarId, connectionId: conn?.id || null, status: calData?.status };
}

async function scheduleBotForCalendarEvent(localEvent, calendarConn, { fetchImpl = global.fetch, retryOptions } = {}) {
  const settings = await getNotetakerSettings();
  if (!settings.recallApiKey) return { ok: false, error: 'Recall API key missing' };

  const nowIso = new Date().toISOString();
  let meetingId = localEvent.meeting_id;
  let sessionId = localEvent.bot_session_id;

  const hostUser = await db.get(`SELECT display_name, email FROM v2_users WHERE id = ?`, [calendarConn.user_id]);
  const firstName = (hostUser?.display_name || hostUser?.email?.split('@')[0] || 'Lalia').trim().split(/\s+/)[0];
  const botDisplayName = `${firstName}'s Lalia Notetaker`.slice(0, 80);

  if (!meetingId || !sessionId) {
    meetingId = db.uuid();
    sessionId = db.uuid();
    const roomName = `cal-${(localEvent.meeting_platform || 'ext').replace('_', '-')}-${crypto.randomUUID().slice(0, 12)}`;
    const hostCode = crypto.randomBytes(4).toString('hex');

    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO v2_meetings (
          id, org_id, host_user_id, livekit_room_name, title, status,
          scheduled_start, host_code, metadata, host_present, meeting_source, external_meeting_url, auto_recap_mode
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          meetingId,
          calendarConn.org_id,
          calendarConn.user_id,
          roomName,
          localEvent.title,
          'scheduled',
          localEvent.start_time,
          hostCode,
          JSON.stringify({
            source: 'calendar_v2',
            platform: localEvent.meeting_platform,
            calendarEventId: localEvent.id,
            botSessionId: sessionId,
          }),
          1,
          localEvent.meeting_platform || 'google_meet',
          localEvent.normalized_meeting_url,
          'host_only',
        ]
      );

      await tx.run(
        `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts)
         VALUES (?,?,?,?)`,
        [meetingId, 0, 1, 1]
      );

      await tx.run(
        `INSERT INTO v2_external_bot_sessions (
          id, org_id, meeting_id, requested_by_user_id, platform, target_url, normalized_url,
          bot_display_name, bot_provider, status, status_detail, scheduled_for, calendar_event_id, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          sessionId,
          calendarConn.org_id,
          meetingId,
          calendarConn.user_id,
          localEvent.meeting_platform || 'google_meet',
          localEvent.normalized_meeting_url,
          localEvent.normalized_meeting_url,
          botDisplayName,
          'recall',
          'scheduled',
          'Scheduling Recall bot from calendar…',
          localEvent.start_time,
          localEvent.id,
          nowIso,
          nowIso,
        ]
      );

      await tx.run(
        `UPDATE v2_calendar_events SET meeting_id = ?, bot_session_id = ?, updated_at = ? WHERE id = ?`,
        [meetingId, sessionId, nowIso, localEvent.id]
      );
    });
  } else {
    await db.run(`UPDATE v2_meetings SET title = ?, scheduled_start = ?, status = 'scheduled' WHERE id = ?`, [
      localEvent.title,
      localEvent.start_time,
      meetingId,
    ]);
  }

  const dedupeKey = `${localEvent.start_time}-${localEvent.normalized_meeting_url}`;
  const botConfig = buildRecallBotPayload({
    meetingUrl: localEvent.normalized_meeting_url,
    joinAtIso: localEvent.start_time,
    botDisplayName,
    platform: localEvent.meeting_platform,
    settings,
    omitMeetingUrl: true,
    metadata: {
      lalia_session_id: sessionId,
      lalia_meeting_id: meetingId,
      lalia_org_id: calendarConn.org_id,
      lalia_calendar_event_id: localEvent.id,
    },
  });

  const res = await fetchWithRecallRetry(
    `${recallApiBase(settings.recallRegion, 'v2')}/calendar-events/${encodeURIComponent(
      localEvent.recall_event_id
    )}/bot/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${settings.recallApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deduplication_key: dedupeKey,
        bot_config: botConfig,
      }),
    },
    { fetchImpl, retryNetwork: true, ...retryOptions }
  );

  const calEventPayload = await res.json().catch(() => null);
  if (!res.ok) {
    const errMsg = calEventPayload?.errors?.non_field_errors?.[0] || calEventPayload?.message || `HTTP ${res.status}`;
    await db.run(
      `UPDATE v2_external_bot_sessions SET status = 'failed', status_detail = ?, updated_at = ? WHERE id = ?`,
      [String(errMsg).slice(0, 260), new Date().toISOString(), sessionId]
    );
    return { ok: false, error: errMsg };
  }

  const recallBotId = calEventPayload?.bots?.[0]?.id ? String(calEventPayload.bots[0].id) : localEvent.scheduled_bot_id;
  await db.run(`UPDATE v2_calendar_events SET scheduled_bot_id = ?, updated_at = ? WHERE id = ?`, [
    recallBotId,
    new Date().toISOString(),
    localEvent.id,
  ]);
  await db.run(
    `UPDATE v2_external_bot_sessions
     SET external_bot_id = COALESCE(?, external_bot_id),
         status = 'scheduled',
         status_detail = ?,
         scheduled_for = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      recallBotId,
      `Scheduled for ${platformDisplayName(localEvent.meeting_platform)}`,
      localEvent.start_time,
      new Date().toISOString(),
      sessionId,
    ]
  );

  return { ok: true, botId: recallBotId, sessionId, meetingId };
}

async function removeBotFromCalendarEvent(localEvent, { fetchImpl = global.fetch, retryOptions } = {}) {
  const settings = await getNotetakerSettings();
  if (!settings.recallApiKey) return { ok: false, error: 'Recall API key missing' };

  const res = await fetchWithRecallRetry(
    `${recallApiBase(settings.recallRegion, 'v2')}/calendar-events/${encodeURIComponent(
      localEvent.recall_event_id
    )}/bot/`,
    {
      method: 'DELETE',
      headers: { Authorization: `Token ${settings.recallApiKey}` },
    },
    { fetchImpl, retryNetwork: true, ...retryOptions }
  );

  if (!res.ok && res.status !== 404) {
    return { ok: false, error: `Delete Calendar Bot HTTP ${res.status}` };
  }

  const nowIso = new Date().toISOString();
  await db.run(`UPDATE v2_calendar_events SET scheduled_bot_id = NULL, updated_at = ? WHERE id = ?`, [
    nowIso,
    localEvent.id,
  ]);
  if (localEvent.bot_session_id) {
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status = 'canceled', status_detail = 'Removed from calendar schedule', ended_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('scheduled', 'queued')`,
      [nowIso, nowIso, localEvent.bot_session_id]
    );
  }
  return { ok: true };
}

async function syncCalendarEventsFromRecall(recallCalendarId, { updatedAtGte = null, fetchImpl = global.fetch, retryOptions } = {}) {
  const settings = await getNotetakerSettings();
  if (!settings.recallApiKey) return { ok: false, error: 'Recall API key missing' };

  let conn = await db.get(`SELECT * FROM v2_calendar_connections WHERE recall_calendar_id = ? LIMIT 1`, [
    String(recallCalendarId),
  ]);
  if (!conn) {
    const check = await handleCalendarUpdateWebhook(recallCalendarId, { fetchImpl, retryOptions });
    if (check.connectionId) {
      conn = await db.get(`SELECT * FROM v2_calendar_connections WHERE id = ?`, [check.connectionId]);
    }
  }
  if (!conn) {
    return { ok: true, unmatched: true, calendarId: recallCalendarId };
  }

  let nextUrl = `${recallApiBase(settings.recallRegion, 'v2')}/calendar-events/?calendar_id=${encodeURIComponent(
    recallCalendarId
  )}`;
  if (updatedAtGte) {
    nextUrl += `&updated_at__gte=${encodeURIComponent(updatedAtGte)}`;
  }

  const fetchedEvents = [];
  let pages = 0;
  while (nextUrl && pages < 50) {
    pages += 1;
    const res = await fetchWithRecallRetry(
      nextUrl,
      { method: 'GET', headers: { Authorization: `Token ${settings.recallApiKey}` } },
      { fetchImpl, retryNetwork: true, ...retryOptions }
    );
    if (!res.ok) {
      throw new Error(`List Calendar Events HTTP ${res.status}`);
    }
    const pageData = await res.json();
    if (Array.isArray(pageData?.results)) {
      fetchedEvents.push(...pageData.results);
    }
    nextUrl = pageData?.next || null;
  }

  // Process chronologically so nearest future meetings are scheduled first
  fetchedEvents.sort((a, b) => new Date(a.start_time || 0).getTime() - new Date(b.start_time || 0).getTime());

  const nowIso = new Date().toISOString();
  let scheduledCount = 0;
  let unscheduledCount = 0;

  for (const calEvent of fetchedEvents) {
    if (!calEvent?.id) continue;
    const parsedUrl = extractMeetingInfoFromRecallEvent(calEvent);
    const title = extractEventTitle(calEvent.raw, parsedUrl, calEvent);
    const organizerEmail = extractOrganizerEmail(calEvent.raw);
    const existing = await db.get(`SELECT * FROM v2_calendar_events WHERE recall_event_id = ? LIMIT 1`, [
      String(calEvent.id),
    ]);

    const localId = existing?.id || db.uuid();
    const isDeleted = calEvent.is_deleted ? 1 : 0;
    const recallBotId = Array.isArray(calEvent.bots) && calEvent.bots[0]?.id ? String(calEvent.bots[0].id) : existing?.scheduled_bot_id || null;

    if (existing) {
      await db.run(
        `UPDATE v2_calendar_events
         SET title = ?, start_time = ?, end_time = ?, meeting_url = ?, normalized_meeting_url = ?,
             meeting_platform = ?, organizer_email = ?, is_deleted = ?, ical_uid = ?,
             scheduled_bot_id = ?, raw_json = ?, updated_at = ?
         WHERE id = ?`,
        [
          title,
          calEvent.start_time || nowIso,
          calEvent.end_time || calEvent.start_time || nowIso,
          calEvent.meeting_url || parsedUrl?.normalizedUrl || null,
          parsedUrl?.normalizedUrl || null,
          parsedUrl?.platform || null,
          organizerEmail,
          isDeleted,
          calEvent.ical_uid || null,
          recallBotId,
          calEvent.raw ? JSON.stringify(calEvent.raw) : null,
          nowIso,
          localId,
        ]
      );
    } else {
      await db.run(
        `INSERT INTO v2_calendar_events (
          id, org_id, user_id, calendar_connection_id, recall_event_id, recall_calendar_id,
          platform, ical_uid, title, start_time, end_time, meeting_url, normalized_meeting_url,
          meeting_platform, organizer_email, is_deleted, scheduled_bot_id, raw_json, updated_at, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          localId,
          conn.org_id,
          conn.user_id,
          conn.id,
          String(calEvent.id),
          String(recallCalendarId),
          String(calEvent.platform || conn.provider),
          calEvent.ical_uid || null,
          title,
          calEvent.start_time || nowIso,
          calEvent.end_time || calEvent.start_time || nowIso,
          calEvent.meeting_url || parsedUrl?.normalizedUrl || null,
          parsedUrl?.normalizedUrl || null,
          parsedUrl?.platform || null,
          organizerEmail,
          isDeleted,
          recallBotId,
          calEvent.raw ? JSON.stringify(calEvent.raw) : null,
          nowIso,
          nowIso,
        ]
      );
    }

    const localEvent = await db.get(`SELECT * FROM v2_calendar_events WHERE id = ?`, [localId]);
    if (isDeleted && localEvent.bot_session_id) {
      await db.run(
        `UPDATE v2_external_bot_sessions
         SET status = 'canceled', status_detail = 'Calendar event deleted', ended_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('scheduled', 'queued')`,
        [nowIso, nowIso, localEvent.bot_session_id]
      );
      continue;
    }

    const decision = evaluateCalendarEventOptIn(localEvent, conn);
    if (!decision.eligible) continue;

    if (decision.shouldRecord) {
      const timeChanged = existing && existing.start_time !== localEvent.start_time;
      if (!localEvent.scheduled_bot_id || timeChanged) {
        const res = await scheduleBotForCalendarEvent(localEvent, conn, { fetchImpl, retryOptions });
        if (res.ok) scheduledCount += 1;
      }
    } else if (localEvent.scheduled_bot_id) {
      const rem = await removeBotFromCalendarEvent(localEvent, { fetchImpl, retryOptions });
      if (rem.ok) unscheduledCount += 1;
    }
  }

  await db.run(`UPDATE v2_calendar_connections SET last_synced_at = ?, updated_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    new Date().toISOString(),
    conn.id,
  ]);

  return {
    ok: true,
    calendarId: recallCalendarId,
    eventsProcessed: fetchedEvents.length,
    scheduledCount,
    unscheduledCount,
  };
}

async function toggleCalendarEventRecording(eventId, { orgId, userId, enabled, fetchImpl = global.fetch } = {}) {
  const localEvent = await db.get(
    `SELECT * FROM v2_calendar_events WHERE id = ? AND org_id = ? AND user_id = ? LIMIT 1`,
    [eventId, orgId, userId]
  );
  if (!localEvent) return { ok: false, status: 404, error: 'Calendar event not found' };

  const conn = await db.get(`SELECT * FROM v2_calendar_connections WHERE id = ?`, [localEvent.calendar_connection_id]);
  if (!conn) return { ok: false, status: 404, error: 'Calendar connection not found' };

  const overrideVal = enabled ? 'enabled' : 'disabled';
  await db.run(`UPDATE v2_calendar_events SET recording_override = ?, updated_at = ? WHERE id = ?`, [
    overrideVal,
    new Date().toISOString(),
    localEvent.id,
  ]);
  const updatedEvent = await db.get(`SELECT * FROM v2_calendar_events WHERE id = ?`, [localEvent.id]);

  if (enabled) {
    const decision = evaluateCalendarEventOptIn(updatedEvent, conn);
    if (!decision.eligible) {
      return {
        ok: false,
        status: 400,
        error:
          decision.reason === 'no_supported_meeting_url'
            ? 'This calendar event does not contain a supported Meet, Teams, Zoom, or Webex link.'
            : 'Cannot schedule a bot for a past or deleted event.',
      };
    }
    const res = await scheduleBotForCalendarEvent(updatedEvent, conn, { fetchImpl });
    if (!res.ok) return { ok: false, status: 502, error: res.error };
  } else if (updatedEvent.scheduled_bot_id) {
    const rem = await removeBotFromCalendarEvent(updatedEvent, { fetchImpl });
    if (!rem.ok) return { ok: false, status: 502, error: rem.error };
  }

  const finalEvent = await db.get(`SELECT * FROM v2_calendar_events WHERE id = ?`, [localEvent.id]);
  return { ok: true, event: finalEvent };
}

async function disconnectRecallCalendar(connId, { orgId, userId, fetchImpl = global.fetch } = {}) {
  const conn = await db.get(
    `SELECT * FROM v2_calendar_connections WHERE id = ? AND org_id = ? AND user_id = ? LIMIT 1`,
    [connId, orgId, userId]
  );
  if (!conn) return { ok: false, status: 404, error: 'Calendar connection not found' };

  const settings = await getNotetakerSettings();
  if (conn.recall_calendar_id && settings.recallApiKey) {
    await fetchWithRecallRetry(
      `${recallApiBase(settings.recallRegion, 'v2')}/calendars/${encodeURIComponent(conn.recall_calendar_id)}/`,
      { method: 'DELETE', headers: { Authorization: `Token ${settings.recallApiKey}` } },
      { fetchImpl, maxAttempts: 3, retryNetwork: true }
    ).catch(() => {});
  }

  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE v2_calendar_connections SET status = 'disconnected', status_detail = 'Disconnected by user', updated_at = ? WHERE id = ?`,
    [nowIso, conn.id]
  );
  await db.run(
    `UPDATE v2_external_bot_sessions
     SET status = 'canceled', status_detail = 'Calendar disconnected', ended_at = ?, updated_at = ?
     WHERE calendar_event_id IN (SELECT id FROM v2_calendar_events WHERE calendar_connection_id = ?)
       AND status IN ('scheduled', 'queued')`,
    [nowIso, nowIso, conn.id]
  );
  await db.run(
    `UPDATE v2_calendar_events SET scheduled_bot_id = NULL, updated_at = ? WHERE calendar_connection_id = ?`,
    [nowIso, conn.id]
  );

  return { ok: true };
}

module.exports = {
  AUTO_JOIN_RULES,
  normalizeAutoJoinRule,
  buildCalendarOAuthForwardRedirect,
  isGoogleCalendarOAuthConfigured,
  mintCalendarOAuthState,
  verifyCalendarOAuthState,
  buildGoogleCalendarConnectUrl,
  completeLaliaGoogleCalendarOAuth,
  evaluateCalendarEventOptIn,
  extractMeetingInfoFromRecallEvent,
  resolveConnectionForRecallCalendar,
  handleCalendarUpdateWebhook,
  syncCalendarEventsFromRecall,
  scheduleBotForCalendarEvent,
  removeBotFromCalendarEvent,
  toggleCalendarEventRecording,
  disconnectRecallCalendar,
};
