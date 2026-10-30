const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseIcsReply,
  meetingIdFromOrganizerAddress,
  meetingIdFromEventUid,
  partstatToRsvpStatus,
  buildMeetingIcs,
  eventUid,
} = require('../lib/icsMeetingInvite');

const MEETING_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const DOMAIN = 'staging.jarmetals.com';

test('buildMeetingIcs includes organizer, attendee, and uid', () => {
  const ics = buildMeetingIcs({
    meetingId: MEETING_ID,
    domain: DOMAIN,
    title: 'Sync',
    startIso: '2026-06-25T18:00:00.000Z',
    endIso: '2026-06-25T19:00:00.000Z',
    joinUrl: 'https://staging.jarmetals.com/join/room',
    hostName: 'Jane Host',
    guestEmail: 'guest@example.com',
    sequence: 0,
  });
  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, new RegExp(`UID:${eventUid(MEETING_ID, DOMAIN).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(ics, /ORGANIZER;CN=Jane Host:mailto:meetings\+/);
  assert.match(ics, /ATTENDEE.*RSVP=TRUE.*guest@example.com/i);
});

test('meetingIdFromOrganizerAddress parses plus addressing', () => {
  assert.equal(
    meetingIdFromOrganizerAddress(`meetings+${MEETING_ID}@${DOMAIN}`),
    MEETING_ID
  );
});

test('parseIcsReply maps PARTSTAT to rsvp status', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    `UID:${MEETING_ID}@${DOMAIN}`,
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:guest@example.com',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const reply = parseIcsReply(ics);
  assert.equal(reply.rsvpStatus, 'accepted');
  assert.equal(reply.attendeeEmail, 'guest@example.com');
  assert.equal(meetingIdFromEventUid(reply.uid, DOMAIN), MEETING_ID);
});

test('partstatToRsvpStatus covers decline and tentative', () => {
  assert.equal(partstatToRsvpStatus('DECLINED'), 'declined');
  assert.equal(partstatToRsvpStatus('TENTATIVE'), 'tentative');
});
