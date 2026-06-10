/**
 * Guest email invites: send join links on invite, and a reminder shortly
 * before the scheduled start.
 *
 * Reminder scheduler: lightweight in-process interval (single PM2 instance).
 * Every poll it finds meetings starting within the reminder window whose
 * emailed guests haven't been reminded, and sends one reminder per guest.
 */
const db = require('../db/v2Database');
const { sendEmail } = require('./mailer');

const REMINDER_WINDOW_MIN = Number(process.env.V2_INVITE_REMINDER_MINUTES || 60);
const POLL_MS = 5 * 60 * 1000;

function friendlyWhen(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

function inviteEmailBody({ meetingTitle, scheduledStart, joinUrl, inviterName, isReminder }) {
  const when = friendlyWhen(scheduledStart);
  const lines = [
    isReminder
      ? `Reminder: "${meetingTitle}" is starting soon.`
      : `${inviterName || 'Your host'} invited you to "${meetingTitle}" on Parley.`,
    '',
    when ? `When: ${when}` : 'This meeting can start at any time.',
    '',
    `Join from your browser (no account needed):`,
    joinUrl,
    '',
    'Parley provides live captions and real-time translation — pick your language when you join.',
  ];
  return lines.join('\n');
}

async function sendGuestInvite({ email, meetingTitle, scheduledStart, joinUrl, inviterName }) {
  return sendEmail({
    to: email,
    subject: `You're invited: ${meetingTitle} — Parley`,
    text: inviteEmailBody({ meetingTitle, scheduledStart, joinUrl, inviterName, isReminder: false }),
  });
}

async function sendGuestReminder({ email, meetingTitle, scheduledStart, joinUrl }) {
  return sendEmail({
    to: email,
    subject: `Starting soon: ${meetingTitle} — Parley`,
    text: inviteEmailBody({ meetingTitle, scheduledStart, joinUrl, isReminder: true }),
  });
}

async function runReminderPass(buildJoinUrl) {
  const due = await db.all(
    `SELECT gi.id, gi.email, gi.meeting_id, m.title, m.scheduled_start, m.livekit_room_name, il.token
     FROM v2_meeting_guest_invites gi
     JOIN v2_meetings m ON m.id = gi.meeting_id
     LEFT JOIN v2_meeting_invite_links il ON il.id = gi.invite_link_id
     WHERE gi.sent_at IS NOT NULL
       AND gi.reminder_sent_at IS NULL
       AND m.scheduled_start IS NOT NULL
       AND m.status IN ('scheduled', 'ready')
       AND datetime(m.scheduled_start) > datetime('now')
       AND datetime(m.scheduled_start) <= datetime('now', '+' || ? || ' minutes')
     LIMIT 100`,
    [REMINDER_WINDOW_MIN]
  );
  for (const row of due) {
    const joinUrl = buildJoinUrl(row.livekit_room_name, row.token);
    const result = await sendGuestReminder({
      email: row.email,
      meetingTitle: row.title || 'Meeting',
      scheduledStart: row.scheduled_start,
      joinUrl,
    });
    if (result?.sent) {
      await db.run(`UPDATE v2_meeting_guest_invites SET reminder_sent_at = datetime('now') WHERE id = ?`, [row.id]);
    } else {
      // Mailer not configured — mark anyway so we don't loop forever; the
      // initial invite already carried the link.
      await db.run(`UPDATE v2_meeting_guest_invites SET reminder_sent_at = datetime('now') WHERE id = ?`, [row.id]);
      break; // no point iterating the rest without a mailer
    }
  }
  return due.length;
}

let timer = null;

function startGuestInviteReminders(buildJoinUrl) {
  if (timer || process.env.V2_DISABLE_INVITE_REMINDERS === '1') return;
  timer = setInterval(() => {
    runReminderPass(buildJoinUrl).catch((e) => console.error('[guestInvites] reminder pass failed:', e.message));
  }, POLL_MS);
  timer.unref?.();
  console.log(`[guestInvites] reminder scheduler started (window: ${REMINDER_WINDOW_MIN} min before start)`);
}

module.exports = { sendGuestInvite, startGuestInviteReminders, runReminderPass };
