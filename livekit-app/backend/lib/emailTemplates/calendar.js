/** @deprecated Use icsMeetingInvite.js — kept for backward-compatible imports. */
const ics = require('./icsMeetingInvite');

function buildMeetingIcs(params) {
  return ics.buildMeetingIcs(params);
}

async function meetingIcsAttachment(params) {
  return ics.meetingIcsAttachment(params);
}

module.exports = { buildMeetingIcs, meetingIcsAttachment };
