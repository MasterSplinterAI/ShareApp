/**
 * iCalendar meeting invites (METHOD:REQUEST/REPLY) for guest email + inbound RSVP.
 */
const { getEmailSettings } = require('./v2EmailSettings');

function extractEmailAddress(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  const match = trimmed.match(/<([^>]+)>/) || trimmed.match(/^([^\s@<>]+@[^\s@<>]+)$/);
  return match ? match[1].toLowerCase() : trimmed.toLowerCase();
}

function extractDomainFromAddress(emailOrFrom) {
  const email = extractEmailAddress(emailOrFrom);
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1) : null;
}

async function resolveIcsDomain() {
  // Prefer the organizer domain stored (encrypted at rest) via Admin →
  // Communications. settings.icsOrganizerDomain already merges the admin value
  // with the PARLEY_ICS_ORGANIZER_DOMAIN env fallback. If neither is set, derive
  // the domain from the configured From address.
  const settings = await getEmailSettings();
  if (settings.icsOrganizerDomain) return settings.icsOrganizerDomain.toLowerCase();
  return extractDomainFromAddress(settings.mailFrom) || 'staging.jarmetals.com';
}

function meetingIdFromOrganizerAddress(address) {
  const email = extractEmailAddress(address);
  const match = email.match(/^meetings\+([a-f0-9-]{36})@/i);
  return match ? match[1] : null;
}

function organizerMailbox(meetingId, domain) {
  return `meetings+${meetingId}@${domain}`;
}

function eventUid(meetingId, domain) {
  return `${meetingId}@${domain}`;
}

function formatIcsUtc(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldIcsLine(line) {
  if (line.length <= 75) return line;
  const parts = [];
  parts.push(line.slice(0, 75));
  let i = 75;
  while (i < line.length) {
    parts.push(` ${line.slice(i, i + 74)}`);
    i += 74;
  }
  return parts.join('\r\n');
}

function buildMeetingIcs({
  meetingId,
  domain,
  title,
  startIso,
  endIso,
  joinUrl,
  description,
  hostName,
  guestEmail,
  sequence = 0,
}) {
  const dtStart = formatIcsUtc(startIso);
  if (!dtStart || !meetingId || !domain || !guestEmail) return null;

  const endDate = endIso
    ? new Date(endIso)
    : new Date(new Date(startIso).getTime() + 60 * 60 * 1000);
  const dtEnd = formatIcsUtc(endDate.toISOString());
  const dtStamp = formatIcsUtc(new Date().toISOString());
  const summary = escapeIcsText(title || 'Parley meeting');
  const desc = escapeIcsText(description || `Join in your browser: ${joinUrl}`);
  const location = escapeIcsText(joinUrl || 'Online');
  const uid = escapeIcsText(eventUid(meetingId, domain));
  const organizerEmail = organizerMailbox(meetingId, domain);
  const organizerCn = escapeIcsText(hostName || 'Meeting host');
  const attendeeEmail = extractEmailAddress(guestEmail);
  const attendeeCn = escapeIcsText(attendeeEmail);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Parley//Meeting Invite//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `ORGANIZER;CN=${organizerCn}:mailto:${organizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${attendeeCn}:mailto:${attendeeEmail}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${location}`,
    `URL:${escapeIcsText(joinUrl)}`,
    'STATUS:CONFIRMED',
    `SEQUENCE:${Math.max(0, Number(sequence) || 0)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

async function meetingIcsAttachment(params) {
  const domain = params.domain || (await resolveIcsDomain());
  const ics = buildMeetingIcs({ ...params, domain });
  if (!ics) return null;
  return {
    filename: 'meeting.ics',
    content: Buffer.from(ics, 'utf8').toString('base64'),
  };
}

function unfoldIcsLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseIcsCalendar(text) {
  const lines = unfoldIcsLines(text);
  let method = null;
  let uid = null;
  let attendeeEmail = null;
  let partstat = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('METHOD:')) {
      method = line.slice(7).trim().toUpperCase();
    } else if (upper.startsWith('UID:')) {
      uid = line.slice(4).trim();
    } else if (upper.startsWith('ATTENDEE')) {
      const mailtoMatch = line.match(/mailto:([^\s;]+)/i);
      if (mailtoMatch) attendeeEmail = extractEmailAddress(mailtoMatch[1]);
      const partMatch = line.match(/PARTSTAT=([^;:]+)/i);
      if (partMatch) partstat = partMatch[1].trim().toUpperCase();
    }
  }

  return { method, uid, attendeeEmail, partstat };
}

function meetingIdFromEventUid(uid, domain) {
  if (!uid) return null;
  const decoded = uid.trim();
  if (domain && decoded.toLowerCase() === eventUid('', domain).replace(/^@/, '')) return null;
  const suffix = domain ? `@${domain.toLowerCase()}` : '';
  if (suffix && decoded.toLowerCase().endsWith(suffix)) {
    const id = decoded.slice(0, -suffix.length);
    if (/^[a-f0-9-]{36}$/i.test(id)) return id;
  }
  const generic = decoded.match(/^([a-f0-9-]{36})@/i);
  return generic ? generic[1] : null;
}

function partstatToRsvpStatus(partstat) {
  switch (String(partstat || '').toUpperCase()) {
    case 'ACCEPTED':
      return 'accepted';
    case 'DECLINED':
      return 'declined';
    case 'TENTATIVE':
      return 'tentative';
    case 'NEEDS-ACTION':
      return 'needs_action';
    default:
      return null;
  }
}

function parseIcsReply(text) {
  const parsed = parseIcsCalendar(text);
  if (parsed.method !== 'REPLY') return null;
  const status = partstatToRsvpStatus(parsed.partstat);
  if (!status) return null;
  return {
    uid: parsed.uid,
    attendeeEmail: parsed.attendeeEmail,
    partstat: parsed.partstat,
    rsvpStatus: status,
  };
}

module.exports = {
  resolveIcsDomain,
  organizerMailbox,
  eventUid,
  meetingIdFromOrganizerAddress,
  meetingIdFromEventUid,
  buildMeetingIcs,
  meetingIcsAttachment,
  parseIcsReply,
  parseIcsCalendar,
  partstatToRsvpStatus,
  extractEmailAddress,
};
