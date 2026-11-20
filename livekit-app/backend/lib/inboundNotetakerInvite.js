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
} = require('./recallNotetaker');

const NOTETAKER_LOCAL_PARTS = new Set(['notes', 'notetaker', 'bot']);

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

function parseIcsTimestamp(rawLine) {
  const colonIdx = rawLine.indexOf(':');
  if (colonIdx < 0) return null;
  const val = rawLine.slice(colonIdx + 1).trim();
  // Match YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i.exec(val);
  if (!m) {
    const parsed = new Date(val);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, y, mo, d, h, mi, s, z] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : 'Z'}`;
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

  if (ics?.method === 'CANCEL' || ics?.status === 'CANCELLED') {
    return { ok: false, error: 'invite_cancelled' };
  }

  // Match Lalia user by sender email first, falling back to .ics ORGANIZER email
  const candidateEmails = [
    extractEmailAddress(fromEmail),
    ics?.organizerEmail ? extractEmailAddress(ics.organizerEmail) : null,
  ].filter(Boolean);

  let userRow = null;
  for (const email of candidateEmails) {
    userRow = await db.get(
      `SELECT id, email, display_name FROM v2_users WHERE LOWER(email) = LOWER(?) AND disabled_at IS NULL LIMIT 1`,
      [email]
    );
    if (userRow) break;
  }

  if (!userRow) {
    return { ok: false, error: 'sender_not_registered' };
  }

  const membership = await db.get(
    `SELECT org_id, role FROM v2_org_members
     WHERE user_id = ?
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END ASC
     LIMIT 1`,
    [userRow.id]
  );
  if (!membership?.org_id) {
    return { ok: false, error: 'no_workspace_for_user' };
  }

  const gate = await assertCanCreateMeeting(membership.org_id);
  if (!gate.ok) {
    return { ok: false, error: gate.code || 'quota_exceeded' };
  }

  // Search .ics fields first, then email body/html for a Meet or Teams link
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

  if (!parsedUrl?.ok) {
    return { ok: false, error: 'no_supported_meeting_url' };
  }

  // Deduplicate active bot sessions for the same org + normalized_url
  const existing = await db.get(
    `SELECT id, meeting_id, status FROM v2_external_bot_sessions
     WHERE org_id = ? AND normalized_url = ? AND status IN ('scheduled', 'queued', 'joining', 'waiting_in_lobby', 'recording')
     LIMIT 1`,
    [membership.org_id, parsedUrl.normalizedUrl]
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
        membership.org_id,
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
        membership.org_id,
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
  hasNotetakerRecipient,
  parseCalendarInviteDetails,
  scheduleNotetakerFromParsedEmail,
  processInboundNotetakerEmail,
};
