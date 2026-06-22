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

/**
 * Build a minimal ICS invite attachment for scheduled meetings.
 */
function buildMeetingIcs({ uid, title, startIso, endIso, joinUrl, description }) {
  const dtStart = formatIcsUtc(startIso);
  if (!dtStart) return null;
  const endDate = endIso
    ? new Date(endIso)
    : new Date(new Date(startIso).getTime() + 60 * 60 * 1000);
  const dtEnd = formatIcsUtc(endDate.toISOString());
  const dtStamp = formatIcsUtc(new Date().toISOString());
  const summary = escapeIcsText(title || 'Parley meeting');
  const desc = escapeIcsText(description || `Join in your browser: ${joinUrl}`);
  const location = escapeIcsText(joinUrl || 'Online');
  const eventUid = escapeIcsText(uid || `parley-${Date.now()}@parley.app`);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Parley//Meeting Invite//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${eventUid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${location}`,
    `URL:${escapeIcsText(joinUrl)}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

function meetingIcsAttachment({ meetingId, title, startIso, endIso, joinUrl }) {
  const ics = buildMeetingIcs({
    uid: `${meetingId || 'meeting'}@parley.app`,
    title,
    startIso,
    endIso,
    joinUrl,
    description: `Live captions and real-time translation. Join: ${joinUrl}`,
  });
  if (!ics) return null;
  return {
    filename: 'meeting.ics',
    content: Buffer.from(ics, 'utf8').toString('base64'),
  };
}

module.exports = { buildMeetingIcs, meetingIcsAttachment };
