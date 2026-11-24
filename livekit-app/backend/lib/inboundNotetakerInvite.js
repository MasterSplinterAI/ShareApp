const crypto = require('crypto');
const db = require('../db/v2Database');
const { parseExternalMeetingUrl } = require('./externalMeetingUrls');
const { extractEmailAddress } = require('./icsMeetingInvite');

function unfoldIcsLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
const {
  fetchReceivedEmail,
  listReceivedAttachments,
  downloadAttachmentText,
} = require('./resendReceivingApi');
const { assertCanCreateMeeting } = require('./v2Entitlements');
const {
  getNotetakerSettings,
  dispatchRecallBotForSession,
  stopRecallBotSession,
} = require('./recallNotetaker');

const NOTETAKER_LOCAL_PARTS = new Set(['notes', 'notetaker', 'bot']);

function getNotetakerInviteEmail() {
  return String(process.env.NOTETAKER_INVITE_EMAIL || 'notes@invite.lalia.cloud')
    .trim()
    .toLowerCase();
}

function isNotetakerRecipientAddress(addr) {
  const clean = extractEmailAddress(addr);
  if (!clean || !clean.includes('@')) return false;
  const local = clean.split('@')[0].split('+')[0].toLowerCase();
  return NOTETAKER_LOCAL_PARTS.has(local);
}

function hasNotetakerRecipient(meta = {}) {
  const list = []
    .concat(meta.to || [])
    .concat(meta.cc || [])
    .filter(Boolean);
  return list.some(isNotetakerRecipientAddress);
}

function unescapeIcsValue(val) {
  return String(val || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

const WINDOWS_TO_IANA_TZ = {
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'us mountain standard time': 'America/Phoenix',
  'pacific standard time': 'America/Los_Angeles',
  'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu',
  'atlantic standard time': 'America/Halifax',
  'gmt standard time': 'Europe/London',
  utc: 'UTC',
  'coordinated universal time': 'UTC',
  'w. europe standard time': 'Europe/Berlin',
  'central european standard time': 'Europe/Budapest',
  'romance standard time': 'Europe/Paris',
  'e. south america standard time': 'America/Sao_Paulo',
  'sa pacific standard time': 'America/Bogota',
  'india standard time': 'Asia/Kolkata',
  'singapore standard time': 'Asia/Singapore',
  'china standard time': 'Asia/Shanghai',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'aus eastern standard time': 'Australia/Sydney',
  'new zealand standard time': 'Pacific/Auckland',
};

function resolveIanaTimeZone(rawTzid) {
  const clean = String(rawTzid || '').trim().replace(/^["']|["']$/g, '');
  if (!clean) return null;
  const mapped = WINDOWS_TO_IANA_TZ[clean.toLowerCase()] || clean;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: mapped });
    return mapped;
  } catch {
    return null;
  }
}

function zonedWallClockToUtcDate(year, month, day, hour, minute, second, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const partOffsetMs = (utcMs) => {
      const parts = {};
      for (const p of fmt.formatToParts(new Date(utcMs))) {
        if (p.type !== 'literal') parts[p.type] = p.value;
      }
      const h = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
      const renderedAsUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        h,
        Number(parts.minute),
        Number(parts.second)
      );
      return renderedAsUtc - utcMs;
    };
    const wallUtcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
    const offset1 = partOffsetMs(wallUtcGuess);
    let candidate = wallUtcGuess - offset1;
    const offset2 = partOffsetMs(candidate);
    if (offset2 !== offset1) {
      candidate = wallUtcGuess - offset2;
    }
    const dt = new Date(candidate);
    return Number.isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}

function parseIcsTimestamp(rawLine) {
  const colonIdx = rawLine.indexOf(':');
  if (colonIdx < 0) return null;
  const paramsPart = rawLine.slice(0, colonIdx);
  const val = rawLine.slice(colonIdx + 1).trim();
  const tzMatch = /(?:^|;)TZID=([^;:]+)/i.exec(paramsPart);
  const tzid = tzMatch ? tzMatch[1] : null;

  // Match YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i.exec(val);
  if (!m) {
    const parsed = new Date(val);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, y, mo, d, h, mi, s, z] = m;
  if (!z && tzid) {
    const ianaZone = resolveIanaTimeZone(tzid);
    if (ianaZone) {
      const zoned = zonedWallClockToUtcDate(
        Number(y),
        Number(mo),
        Number(d),
        Number(h),
        Number(mi),
        Number(s),
        ianaZone
      );
      if (zoned) return zoned;
    }
  }
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseCalendarInviteDetails(icsText) {
  if (!icsText || !String(icsText).includes('BEGIN:VCALENDAR')) return null;
  const lines = unfoldIcsLines(icsText);
  let uid = null;
  let summary = null;
  let description = null;
  let location = null;
  let url = null;
  let organizerEmail = null;
  let dtStart = null;
  let method = null;
  let status = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('METHOD:')) {
      method = line.slice(7).trim().toUpperCase();
    } else if (upper.startsWith('STATUS:')) {
      status = line.slice(7).trim().toUpperCase();
    } else if (upper.startsWith('UID:')) {
      uid = unescapeIcsValue(line.slice(4));
    } else if (upper.startsWith('SUMMARY') && line.includes(':')) {
      summary = unescapeIcsValue(line.slice(line.indexOf(':') + 1));
    } else if (upper.startsWith('DESCRIPTION') && line.includes(':')) {
      description = unescapeIcsValue(line.slice(line.indexOf(':') + 1));
    } else if (upper.startsWith('LOCATION') && line.includes(':')) {
      location = unescapeIcsValue(line.slice(line.indexOf(':') + 1));
    } else if (upper.startsWith('URL') && line.includes(':')) {
      url = unescapeIcsValue(line.slice(line.indexOf(':') + 1));
    } else if (upper.startsWith('ORGANIZER')) {
      const m = line.match(/mailto:([^\s;]+)/i);
      if (m) organizerEmail = extractEmailAddress(m[1]);
    } else if (upper.startsWith('DTSTART')) {
      dtStart = parseIcsTimestamp(line);
    }
  }

  return {
    uid,
    summary,
    description,
    location,
    url,
    organizerEmail,
    dtStart,
    method,
    status,
  };
}

/**
 * Schedules a Notetaker bot session from a parsed inbound email / .ics invite
 * (works universally with Proton Mail, Apple iCloud, Fastmail, Outlook, Gmail, etc.).
 */
async function scheduleNotetakerFromParsedEmail({
  fromEmail,
  subject = '',
  textBody = '',
  htmlBody = '',
  icsTexts = [],
}) {
  let ics = null;
  for (const rawIcs of icsTexts) {
    const parsed = parseCalendarInviteDetails(rawIcs);
    if (parsed) {
      ics = parsed;
      break;
    }
  }

  // Match Lalia user by sender email / .ics ORGANIZER email first, then connected calendar mailbox
  const candidateEmails = [
    extractEmailAddress(fromEmail),
    ics?.organizerEmail ? extractEmailAddress(ics.organizerEmail) : null,
  ].filter(Boolean);

  let userRow = null;
  let preferredOrgId = null;
  for (const email of candidateEmails) {
    userRow = await db.get(
      `SELECT id, email, display_name FROM v2_users WHERE LOWER(email) = LOWER(?) AND disabled_at IS NULL LIMIT 1`,
      [email]
    );
    if (userRow) break;
  }
  if (!userRow) {
    for (const email of candidateEmails) {
      const calConn = await db.get(
        `SELECT user_id, org_id FROM v2_calendar_connections
         WHERE LOWER(account_email) = LOWER(?) AND status != 'disconnected'
         ORDER BY updated_at DESC LIMIT 1`,
        [email]
      );
      if (calConn?.user_id) {
        const linkedUser = await db.get(
          `SELECT id, email, display_name FROM v2_users WHERE id = ? AND disabled_at IS NULL LIMIT 1`,
          [calConn.user_id]
        );
        if (linkedUser) {
          userRow = linkedUser;
          preferredOrgId = calConn.org_id || null;
          break;
        }
      }
    }
  }

  if (!userRow) {
    return { ok: false, error: 'sender_not_registered' };
  }

  let orgId = preferredOrgId;
  if (!orgId) {
    const membership = await db.get(
      `SELECT org_id, role FROM v2_org_members
       WHERE user_id = ?
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END ASC
       LIMIT 1`,
      [userRow.id]
    );
    orgId = membership?.org_id || null;
  }
  if (!orgId) {
    return { ok: false, error: 'no_workspace_for_user' };
  }

  // Search .ics fields first, then email body/html for a Meet, Teams, Zoom, or Webex link
  const searchSources = [
    ics?.location,
    ics?.url,
    ics?.description,
    textBody,
    htmlBody ? String(htmlBody).replace(/<[^>]+>/g, ' ') : '',
  ].filter(Boolean);

  let parsedUrl = null;
  for (const src of searchSources) {
    const candidate = parseExternalMeetingUrl(src);
    if (candidate.ok) {
      parsedUrl = candidate;
      break;
    }
  }

  if (ics?.method === 'CANCEL' || ics?.status === 'CANCELLED') {
    const activeCandidates = await db.all(
      `SELECT s.*, m.metadata AS meeting_metadata
       FROM v2_external_bot_sessions s
       JOIN v2_meetings m ON m.id = s.meeting_id
       WHERE s.org_id = ? AND s.status IN ('scheduled', 'queued')`,
      [orgId]
    );
    const matched = activeCandidates.find((s) => {
      if (ics?.uid && s.meeting_metadata) {
        try {
          const meta = JSON.parse(s.meeting_metadata);
          if (meta?.icsUid && String(meta.icsUid) === String(ics.uid)) return true;
        } catch {
          /* ignore malformed metadata */
        }
      }
      return Boolean(parsedUrl?.ok && s.normalized_url === parsedUrl.normalizedUrl);
    });
    if (!matched) {
      return { ok: false, error: 'invite_cancelled' };
    }
    if (matched.bot_provider === 'recall') {
      await stopRecallBotSession(matched).catch((err) => {
        console.warn('[inboundNotetakerInvite] Cancel recall bot warning:', err.message);
      });
    } else {
      const nowIso = new Date().toISOString();
      await db.run(
        `UPDATE v2_external_bot_sessions
         SET status = 'canceled', stop_requested = 1, status_detail = 'Canceled via calendar invite', ended_at = ?, updated_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, matched.id]
      );
      await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = ? WHERE id = ?`, [
        nowIso,
        matched.meeting_id,
      ]);
    }
    return {
      ok: true,
      canceled: true,
      sessionId: matched.id,
      meetingId: matched.meeting_id,
    };
  }

  const gate = await assertCanCreateMeeting(orgId);
  if (!gate.ok) {
    return { ok: false, error: gate.code || 'quota_exceeded' };
  }

  if (!parsedUrl?.ok) {
    return { ok: false, error: 'no_supported_meeting_url' };
  }

  // Deduplicate active bot sessions for the same org + normalized_url
  const existing = await db.get(
    `SELECT id, meeting_id, status FROM v2_external_bot_sessions
     WHERE org_id = ? AND normalized_url = ? AND status IN ('scheduled', 'queued', 'joining', 'waiting_in_lobby', 'recording')
     LIMIT 1`,
    [orgId, parsedUrl.normalizedUrl]
  );
  if (existing) {
    return {
      ok: true,
      deduplicated: true,
      sessionId: existing.id,
      meetingId: existing.meeting_id,
    };
  }

  const cleanSubject = String(subject || '')
    .replace(/^(fwd?|fw|re|invitation|updated invitation):\s*/gi, '')
    .trim();
  const title = (ics?.summary || cleanSubject || parsedUrl.defaultTitle).slice(0, 200);

  const firstName = (userRow.display_name || userRow.email.split('@')[0] || 'Lalia')
    .trim()
    .split(/\s+/)[0];
  const botDisplayName = `${firstName}'s Lalia Notetaker`.slice(0, 80);

  const nowMs = Date.now();
  const startDt = ics?.dtStart || null;
  const isFutureSchedule = Boolean(startDt && startDt.getTime() > nowMs + 60_000);
  const scheduledIso = startDt ? startDt.toISOString() : null;
  const nowIso = new Date(nowMs).toISOString();

  const meetingId = db.uuid();
  const sessionId = db.uuid();
  const placeholderRoomName = `ext-${parsedUrl.platform.replace('_', '-')}-${crypto.randomUUID().slice(0, 12)}`;
  const hostCode = crypto.randomBytes(4).toString('hex');
  const ntSettings = await getNotetakerSettings();
  const useRecall = ntSettings.effectiveDriver === 'recall';
  const botProvider = useRecall ? 'recall' : 'worker';

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO v2_meetings (
        id, org_id, host_user_id, livekit_room_name, title, status,
        scheduled_start, started_at, host_code, metadata, host_present,
        meeting_source, external_meeting_url, auto_recap_mode
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        meetingId,
        orgId,
        userRow.id,
        placeholderRoomName,
        title,
        isFutureSchedule ? 'scheduled' : 'live',
        scheduledIso,
        isFutureSchedule ? null : nowIso,
        hostCode,
        JSON.stringify({
          source: 'email_invite_notetaker',
          platform: parsedUrl.platform,
          botSessionId: sessionId,
          botProvider,
          icsUid: ics?.uid || null,
        }),
        1,
        parsedUrl.platform,
        parsedUrl.normalizedUrl,
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
        id, org_id, meeting_id, requested_by_user_id, platform,
        target_url, normalized_url, external_meeting_code, bot_display_name,
        bot_provider, status, status_detail, scheduled_for, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        sessionId,
        orgId,
        meetingId,
        userRow.id,
        parsedUrl.platform,
        parsedUrl.normalizedUrl,
        parsedUrl.normalizedUrl,
        parsedUrl.externalCode || null,
        botDisplayName,
        botProvider,
        isFutureSchedule ? 'scheduled' : 'queued',
        isFutureSchedule
          ? `Scheduled via email invite for ${parsedUrl.platformLabel}`
          : `Queued via email invite for ${parsedUrl.platformLabel}…`,
        scheduledIso,
        nowIso,
        nowIso,
      ]
    );
  });

  if (useRecall) {
    await dispatchRecallBotForSession(sessionId).catch((err) => {
      console.warn('[inboundNotetakerInvite] Recall dispatch warning:', err.message);
    });
  }

  return {
    ok: true,
    sessionId,
    meetingId,
    platform: parsedUrl.platform,
    scheduledFor: scheduledIso,
  };
}

async function processInboundNotetakerEmail(emailId, emailMeta = {}) {
  const icsTexts = [];
  let subject = emailMeta.subject || '';
  let textBody = '';
  let htmlBody = '';

  try {
    const email = await fetchReceivedEmail(emailId);
    if (email?.subject) subject = email.subject;
    if (email?.text) textBody = email.text;
    if (email?.html) htmlBody = email.html;
    if (email?.text && String(email.text).includes('BEGIN:VCALENDAR')) {
      icsTexts.push(email.text);
    }
    if (email?.raw?.text && String(email.raw.text).includes('BEGIN:VCALENDAR')) {
      icsTexts.push(email.raw.text);
    }
  } catch (e) {
    console.warn('[inboundNotetakerInvite] fetchReceivedEmail failed:', e.message);
  }

  try {
    const attachments = await listReceivedAttachments(emailId);
    for (const att of attachments) {
      const ct = String(att.content_type || '').toLowerCase();
      const name = String(att.filename || '').toLowerCase();
      const isCalendar =
        ct.includes('text/calendar') || ct.includes('application/ics') || name.endsWith('.ics');
      if (!isCalendar || !att.download_url) continue;
      const content = await downloadAttachmentText(att.download_url).catch(() => '');
      if (content) icsTexts.push(content);
    }
  } catch (e) {
    console.warn('[inboundNotetakerInvite] listReceivedAttachments failed:', e.message);
  }

  return scheduleNotetakerFromParsedEmail({
    fromEmail: emailMeta.from,
    subject,
    textBody,
    htmlBody,
    icsTexts,
  });
}

module.exports = {
  getNotetakerInviteEmail,
  hasNotetakerRecipient,
  parseCalendarInviteDetails,
  parseIcsTimestamp,
  scheduleNotetakerFromParsedEmail,
  processInboundNotetakerEmail,
};
