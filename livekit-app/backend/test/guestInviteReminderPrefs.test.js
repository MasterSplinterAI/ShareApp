const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeOffsets,
  parseOffsetsJson,
  isValidIanaTimezone,
  parseRemindersSent,
  reminderOffsetLabel,
  DEFAULT_REMINDER_OFFSETS,
} = require('../lib/guestInviteReminderPrefs');
const { friendlyWhen } = require('../lib/emailTemplates/formatMeetingTime');

test('normalizeOffsets defaults and sorts descending', () => {
  assert.deepEqual(normalizeOffsets([15, 1440, 15, 3]), [1440, 15]);
  assert.equal(normalizeOffsets([]), null);
});

test('parseOffsetsJson handles invalid input', () => {
  assert.equal(parseOffsetsJson(null), null);
  assert.equal(parseOffsetsJson('not-json'), null);
  assert.deepEqual(parseOffsetsJson('[1440,15]'), [1440, 15]);
});

test('default reminder offsets are 1 day and 15 minutes', () => {
  assert.deepEqual(DEFAULT_REMINDER_OFFSETS, [1440, 15]);
});

test('parseRemindersSent migrates legacy reminder_sent_at', () => {
  const map = parseRemindersSent({ reminder_sent_at: '2026-01-01T00:00:00.000Z' });
  assert.equal(map['60'], '2026-01-01T00:00:00.000Z');
});

test('isValidIanaTimezone validates IANA names', () => {
  assert.equal(isValidIanaTimezone('America/New_York'), true);
  assert.equal(isValidIanaTimezone('Not/A/Timezone'), false);
});

test('reminderOffsetLabel formats offsets', () => {
  assert.equal(reminderOffsetLabel(1440), '1 day before');
  assert.equal(reminderOffsetLabel(15), '15 minutes before');
});

test('friendlyWhen includes timezone name and IANA id', () => {
  const formatted = friendlyWhen('2026-06-24T18:00:00.000Z', 'America/New_York');
  assert.match(formatted, /America\/New_York/);
  assert.match(formatted, /2026/);
});
