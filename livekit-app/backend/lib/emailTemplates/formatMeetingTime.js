const { sanitizeTimezone, defaultTimezone } = require('../guestInviteReminderPrefs');

function timezoneLongName(iso, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'long',
    }).formatToParts(new Date(iso));
    return parts.find((p) => p.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Format meeting time in a specific IANA timezone with explicit timezone label.
 * Example: "Tuesday, Jun 24, 2026 at 2:00 PM Eastern Daylight Time (America/New_York)"
 */
function friendlyWhen(iso, timeZone) {
  if (!iso) return null;
  const tz = sanitizeTimezone(timeZone || defaultTimezone());
  try {
    const d = new Date(iso);
    const datePart = d.toLocaleString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    });
    const tzLong = timezoneLongName(iso, tz);
    return `${datePart} ${tzLong} (${tz})`;
  } catch {
    return iso;
  }
}

function timezoneNoteHtml(timeZone) {
  const tz = sanitizeTimezone(timeZone || defaultTimezone());
  return `<p style="margin:0;font-size:13px;color:#64748b;">Times shown in the host&apos;s timezone (${tz}).</p>`;
}

module.exports = { friendlyWhen, timezoneLongName, timezoneNoteHtml };
