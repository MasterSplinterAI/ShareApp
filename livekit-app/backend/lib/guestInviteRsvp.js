/**
 * Apply inbound calendar RSVP replies to guest invite records.
 */
const db = require('../db/v2Database');
const {
  parseIcsReply,
  meetingIdFromOrganizerAddress,
  meetingIdFromEventUid,
  extractEmailAddress,
  resolveIcsDomain,
} = require('./icsMeetingInvite');
const {
  fetchReceivedEmail,
  listReceivedAttachments,
  downloadAttachmentText,
} = require('./resendReceivingApi');

async function findIcsReplyTexts(emailId, emailMeta = {}) {
  const texts = [];

  try {
    const email = await fetchReceivedEmail(emailId);
    if (email?.text) texts.push(email.text);
    if (email?.html && String(email.html).includes('BEGIN:VCALENDAR')) {
      texts.push(email.html);
    }
    if (email?.raw?.text) texts.push(email.raw.text);
  } catch (e) {
    console.warn('[guestInviteRsvp] fetchReceivedEmail failed:', e.message);
  }

  try {
    const attachments = await listReceivedAttachments(emailId);
    for (const att of attachments) {
      const ct = String(att.content_type || '').toLowerCase();
      const name = String(att.filename || '').toLowerCase();
      const isCalendar =
        ct.includes('text/calendar') || ct.includes('application/ics') || name.endsWith('.ics');
      if (!isCalendar || !att.download_url) continue;
      try {
        texts.push(await downloadAttachmentText(att.download_url));
      } catch (e) {
        console.warn('[guestInviteRsvp] attachment download failed:', att.filename, e.message);
      }
    }
  } catch (e) {
    console.warn('[guestInviteRsvp] listReceivedAttachments failed:', e.message);
  }

  if (emailMeta.rawBody && String(emailMeta.rawBody).includes('BEGIN:VCALENDAR')) {
    texts.push(emailMeta.rawBody);
  }

  return texts;
}

function resolveMeetingId({ toAddresses, uid, domain }) {
  for (const addr of toAddresses || []) {
    const fromMailbox = meetingIdFromOrganizerAddress(addr);
    if (fromMailbox) return fromMailbox;
  }
  return meetingIdFromEventUid(uid, domain);
}

async function applyGuestRsvp({ meetingId, guestEmail, rsvpStatus }) {
  if (!meetingId || !guestEmail || !rsvpStatus) {
    return { ok: false, error: 'missing_fields' };
  }

  const meeting = await db.get(`SELECT id FROM v2_meetings WHERE id = ?`, [meetingId]);
  if (!meeting) return { ok: false, error: 'meeting_not_found' };

  const guestEmailNorm = extractEmailAddress(guestEmail);
  const row = await db.get(
    `SELECT id FROM v2_meeting_guest_invites
     WHERE meeting_id = ? AND lower(email) = lower(?)
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [meetingId, guestEmailNorm]
  );
  if (!row) return { ok: false, error: 'guest_not_found', meetingId, guestEmail: guestEmailNorm };

  const now = new Date().toISOString();
  await db.run(
    `UPDATE v2_meeting_guest_invites SET rsvp_status = ?, rsvp_updated_at = ? WHERE id = ?`,
    [rsvpStatus, now, row.id]
  );

  return { ok: true, meetingId, guestEmail: guestEmailNorm, rsvpStatus, guestInviteId: row.id };
}

async function processInboundRsvpEmail(emailId, emailMeta = {}) {
  const domain = await resolveIcsDomain();
  const toAddresses = []
    .concat(emailMeta.to || [])
    .concat(emailMeta.cc || [])
    .filter(Boolean);

  const texts = await findIcsReplyTexts(emailId, emailMeta);
  let reply = null;
  for (const text of texts) {
    reply = parseIcsReply(text);
    if (reply) break;
  }

  if (!reply) {
    return { ok: false, error: 'no_ics_reply', emailId };
  }

  const meetingId = resolveMeetingId({ toAddresses, uid: reply.uid, domain });
  if (!meetingId) {
    return { ok: false, error: 'meeting_not_resolved', uid: reply.uid, emailId };
  }

  const guestEmail = reply.attendeeEmail || extractEmailAddress(emailMeta.from);
  return applyGuestRsvp({
    meetingId,
    guestEmail,
    rsvpStatus: reply.rsvpStatus,
  });
}

async function recordInboundEvent(id, payloadJson) {
  const existing = await db.get(`SELECT id FROM v2_resend_inbound_events WHERE id = ?`, [id]);
  if (existing) return { duplicate: true };
  await db.run(
    `INSERT INTO v2_resend_inbound_events (id, payload_json, processed_at) VALUES (?,?,?)`,
    [id, payloadJson, new Date().toISOString()]
  );
  return { duplicate: false };
}

module.exports = {
  processInboundRsvpEmail,
  applyGuestRsvp,
  findIcsReplyTexts,
  recordInboundEvent,
};
