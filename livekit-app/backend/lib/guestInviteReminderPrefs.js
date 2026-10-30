/**
 * Guest invite reminder offsets, CC-host preference, and host timezone helpers.
 */
const db = require('../db/v2Database');

const DEFAULT_REMINDER_OFFSETS = [1440, 15];
const POLL_SLACK_MIN = 6;
const MIN_OFFSET = 5;
const MAX_OFFSET = 10080;

function normalizeOffsets(arr) {
  if (!Array.isArray(arr)) return null;
  const nums = [
    ...new Set(
      arr
        .map((n) => parseInt(n, 10))
        .filter((n) => Number.isFinite(n) && n >= MIN_OFFSET && n <= MAX_OFFSET)
    ),
  ].sort((a, b) => b - a);
  return nums.length ? nums : null;
}

function parseOffsetsJson(json) {
  if (!json) return null;
  try {
    return normalizeOffsets(JSON.parse(json));
  } catch {
    return null;
  }
}

function offsetsToJson(offsets) {
  const normalized = normalizeOffsets(offsets);
  return normalized ? JSON.stringify(normalized) : null;
}

function isValidIanaTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (!trimmed) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

function defaultTimezone() {
  return 'UTC';
}

function sanitizeTimezone(tz) {
  return isValidIanaTimezone(tz) ? String(tz).trim() : defaultTimezone();
}

function parseRemindersSent(row) {
  const map = {};
  if (row?.reminders_sent_json) {
    try {
      const parsed = JSON.parse(row.reminders_sent_json);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (v) map[String(k)] = v;
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (row?.reminder_sent_at && !Object.keys(map).length) {
    map['60'] = row.reminder_sent_at;
  }
  return map;
}

function reminderOffsetLabel(offsetMin) {
  if (offsetMin >= 1440 && offsetMin % 1440 === 0) {
    const days = offsetMin / 1440;
    return days === 1 ? '1 day before' : `${days} days before`;
  }
  if (offsetMin >= 60 && offsetMin % 60 === 0) {
    const hours = offsetMin / 60;
    return hours === 1 ? '1 hour before' : `${hours} hours before`;
  }
  return offsetMin === 1 ? '1 minute before' : `${offsetMin} minutes before`;
}

async function getGuestInvitePrefs(userId) {
  if (!userId) {
    return {
      timezone: defaultTimezone(),
      reminderOffsets: DEFAULT_REMINDER_OFFSETS,
      ccHost: true,
    };
  }
  const row = await db.get(
    `SELECT timezone, guest_invite_reminder_offsets_json, guest_invite_cc_host
     FROM v2_user_communication_prefs WHERE user_id = ?`,
    [userId]
  );
  return {
    timezone: sanitizeTimezone(row?.timezone),
    reminderOffsets: parseOffsetsJson(row?.guest_invite_reminder_offsets_json) || DEFAULT_REMINDER_OFFSETS,
    ccHost: row?.guest_invite_cc_host !== 0,
  };
}

async function getEffectiveReminderOffsets(meetingId) {
  const meeting = await db.get(
    `SELECT host_user_id, guest_invite_reminder_offsets_json FROM v2_meetings WHERE id = ?`,
    [meetingId]
  );
  if (!meeting) return [...DEFAULT_REMINDER_OFFSETS];
  const meetingOffsets = parseOffsetsJson(meeting.guest_invite_reminder_offsets_json);
  if (meetingOffsets) return meetingOffsets;
  const hostPrefs = await getGuestInvitePrefs(meeting.host_user_id);
  return hostPrefs.reminderOffsets;
}

async function getHostTimezoneForMeeting(meetingId) {
  const meeting = await db.get(`SELECT host_user_id FROM v2_meetings WHERE id = ?`, [meetingId]);
  if (!meeting?.host_user_id) return defaultTimezone();
  const hostPrefs = await getGuestInvitePrefs(meeting.host_user_id);
  return hostPrefs.timezone;
}

async function getMeetingInviteEmailSettings(meetingId, userId) {
  const meeting = await db.get(
    `SELECT guest_invite_reminder_offsets_json, host_user_id FROM v2_meetings WHERE id = ?`,
    [meetingId]
  );
  const accountPrefs = await getGuestInvitePrefs(userId || meeting?.host_user_id);
  const meetingOffsets = parseOffsetsJson(meeting?.guest_invite_reminder_offsets_json);
  return {
    reminderOffsets: meetingOffsets || accountPrefs.reminderOffsets,
    usingAccountDefaults: !meetingOffsets,
    accountDefaults: accountPrefs.reminderOffsets,
    timezone: accountPrefs.timezone,
    ccHost: accountPrefs.ccHost,
  };
}

module.exports = {
  DEFAULT_REMINDER_OFFSETS,
  POLL_SLACK_MIN,
  MIN_OFFSET,
  MAX_OFFSET,
  normalizeOffsets,
  parseOffsetsJson,
  offsetsToJson,
  isValidIanaTimezone,
  defaultTimezone,
  sanitizeTimezone,
  parseRemindersSent,
  reminderOffsetLabel,
  getGuestInvitePrefs,
  getEffectiveReminderOffsets,
  getHostTimezoneForMeeting,
  getMeetingInviteEmailSettings,
};
