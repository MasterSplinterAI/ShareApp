/**
 * Guest email invites: send join links on invite, and reminders before
 * the scheduled start at configurable offsets (default: 1 day + 15 min).
 *
 * Reminder scheduler: lightweight in-process interval (single PM2 instance).
 */
const db = require('../db/v2Database');
const { sendEmail } = require('./mailer');
const { renderGuestInvite, renderGuestReminder } = require('./emailTemplates');
const {
  DEFAULT_REMINDER_OFFSETS,
  parseRemindersSent,
  getGuestInvitePrefs,
  getEffectiveReminderOffsets,
  getHostTimezoneForMeeting,
} = require('./guestInviteReminderPrefs');

const POLL_MS = 5 * 60 * 1000;

async function sendGuestInvite({
  email,
  meetingTitle,
  scheduledStart,
  scheduledEnd,
  joinUrl,
  inviterName,
  meetingId,
  timeZone,
  cc,
}) {
  const rendered = renderGuestInvite({
    meetingTitle,
    scheduledStart,
    scheduledEnd,
    joinUrl,
    inviterName,
    meetingId,
    timeZone,
  });
  const ccList = cc ? (Array.isArray(cc) ? cc : [cc]).filter((c) => c && c.toLowerCase() !== email.toLowerCase()) : [];
  return sendEmail({
    to: email,
    cc: ccList.length ? ccList : undefined,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: rendered.attachments,
  });
}

async function sendGuestReminder({
  email,
  meetingTitle,
  scheduledStart,
  scheduledEnd,
  joinUrl,
  meetingId,
  timeZone,
  offsetMinutes,
}) {
  const rendered = renderGuestReminder({
    meetingTitle,
    scheduledStart,
    scheduledEnd,
    joinUrl,
    meetingId,
    timeZone,
    offsetMinutes,
  });
  return sendEmail({
    to: email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: rendered.attachments,
  });
}

async function runReminderPass(buildJoinUrl) {
  const candidates = await db.all(
    `SELECT gi.id, gi.email, gi.meeting_id, gi.reminders_sent_json, gi.reminder_sent_at,
            m.title, m.scheduled_start, m.scheduled_end, m.livekit_room_name, m.host_user_id,
            m.guest_invite_reminder_offsets_json, il.token
     FROM v2_meeting_guest_invites gi
     JOIN v2_meetings m ON m.id = gi.meeting_id
     LEFT JOIN v2_meeting_invite_links il ON il.id = gi.invite_link_id
     WHERE gi.sent_at IS NOT NULL
       AND m.scheduled_start IS NOT NULL
       AND m.status IN ('scheduled', 'ready')
       AND datetime(m.scheduled_start) > datetime('now')
     LIMIT 500`
  );

  const offsetsCache = new Map();
  const timezoneCache = new Map();
  let sentCount = 0;

  for (const row of candidates) {
    let offsets = offsetsCache.get(row.meeting_id);
    if (!offsets) {
      offsets = await getEffectiveReminderOffsets(row.meeting_id);
      offsetsCache.set(row.meeting_id, offsets);
    }

    let timeZone = timezoneCache.get(row.meeting_id);
    if (!timeZone) {
      timeZone = await getHostTimezoneForMeeting(row.meeting_id);
      timezoneCache.set(row.meeting_id, timeZone);
    }

    const sentMap = parseRemindersSent(row);
    const startMs = new Date(row.scheduled_start).getTime();
    const nowMs = Date.now();

    for (const offsetMin of offsets) {
      const key = String(offsetMin);
      if (sentMap[key]) continue;

      const remindAtMs = startMs - offsetMin * 60 * 1000;
      if (nowMs < remindAtMs) continue;
      if (nowMs >= startMs) continue;

      const joinUrl = buildJoinUrl(row.livekit_room_name, row.token);
      const result = await sendGuestReminder({
        email: row.email,
        meetingTitle: row.title || 'Meeting',
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end,
        joinUrl,
        meetingId: row.meeting_id,
        timeZone,
        offsetMinutes: offsetMin,
      });

      if (result?.sent) {
        sentMap[key] = new Date().toISOString();
        await db.run(`UPDATE v2_meeting_guest_invites SET reminders_sent_json = ? WHERE id = ?`, [
          JSON.stringify(sentMap),
          row.id,
        ]);
        sentCount += 1;
      } else {
        return sentCount;
      }
    }
  }

  return sentCount;
}

let timer = null;

function startGuestInviteReminders(buildJoinUrl) {
  if (timer || process.env.V2_DISABLE_INVITE_REMINDERS === '1') return;
  timer = setInterval(() => {
    runReminderPass(buildJoinUrl).catch((e) => console.error('[guestInvites] reminder pass failed:', e.message));
  }, POLL_MS);
  timer.unref?.();
  console.log(
    `[guestInvites] reminder scheduler started (default offsets: ${DEFAULT_REMINDER_OFFSETS.join(', ')} min before start)`
  );
}

module.exports = { sendGuestInvite, sendGuestReminder, startGuestInviteReminders, runReminderPass };
