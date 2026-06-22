const { renderEmailLayout } = require('./layout');
const { escapeHtml } = require('./escape');
const { meetingIcsAttachment } = require('./calendar');
const { friendlyWhen, timezoneNoteHtml } = require('./formatMeetingTime');
const { reminderOffsetLabel } = require('../guestInviteReminderPrefs');

function renderGuestInvite({
  meetingTitle,
  scheduledStart,
  scheduledEnd,
  joinUrl,
  inviterName,
  meetingId,
  timeZone,
}) {
  const title = meetingTitle || 'Meeting';
  const when = friendlyWhen(scheduledStart, timeZone);
  const inviter = inviterName || 'Your host';
  const subject = `You're invited: ${title} — Parley`;
  const text = [
    `${inviter} invited you to "${title}" on Parley.`,
    '',
    when ? `Scheduled for: ${when}` : 'This meeting can start at any time.',
    ...(when ? ['', 'Times shown in the host\'s timezone.'] : []),
    '',
    'Join from your browser (no account needed):',
    joinUrl,
    '',
    'Parley provides live captions and real-time translation — pick your language when you join.',
  ].join('\n');

  const detailRows = [
    { label: 'Host', value: inviter },
    ...(when ? [{ label: 'When', value: when }] : []),
    { label: 'Meeting', value: title },
  ];

  const html = renderEmailLayout({
    preheader: `${inviter} invited you to a Parley meeting.`,
    title: `You're invited to ${title}`,
    introHtml: `<p style="margin:0;">${escapeHtml(inviter)} invited you to join a Parley video meeting with live captions and real-time translation. No account is required — just open the link in your browser.</p>`,
    detailRows,
    ctaUrl: joinUrl,
    ctaLabel: 'Join meeting',
    secondaryHtml: [
      scheduledStart
        ? '<p style="margin:0;">A calendar invite is attached so you can add this meeting to your schedule.</p>'
        : '',
      when ? timezoneNoteHtml(timeZone) : '',
    ]
      .filter(Boolean)
      .join(''),
  });

  const attachments = [];
  if (scheduledStart) {
    const ics = meetingIcsAttachment({
      meetingId,
      title,
      startIso: scheduledStart,
      endIso: scheduledEnd,
      joinUrl,
    });
    if (ics) attachments.push(ics);
  }

  return { subject, text, html, attachments };
}

function renderGuestReminder({
  meetingTitle,
  scheduledStart,
  scheduledEnd,
  joinUrl,
  meetingId,
  timeZone,
  offsetMinutes,
}) {
  const title = meetingTitle || 'Meeting';
  const when = friendlyWhen(scheduledStart, timeZone);
  const lead = offsetMinutes != null ? reminderOffsetLabel(offsetMinutes) : 'before start';
  const isDayBefore = offsetMinutes != null && offsetMinutes >= 1440;
  const subject = isDayBefore ? `Tomorrow: ${title} — Parley` : `Starting soon: ${title} — Parley`;
  const text = [
    `Reminder (${lead}): "${title}" is coming up.`,
    '',
    when ? `Scheduled for: ${when}` : '',
    ...(when ? ['', 'Times shown in the host\'s timezone.'] : []),
    '',
    'Join from your browser:',
    joinUrl,
    '',
    'Parley provides live captions and real-time translation — pick your language when you join.',
  ]
    .filter(Boolean)
    .join('\n');

  const html = renderEmailLayout({
    preheader: `Your Parley meeting "${title}" is coming up (${lead}).`,
    title: isDayBefore ? 'Your meeting is tomorrow' : 'Your meeting is starting soon',
    introHtml: `<p style="margin:0;">This is a reminder (${escapeHtml(lead)}) that <strong>${escapeHtml(title)}</strong> is coming up. Join from your browser — live captions and translation are ready when you arrive.</p>`,
    detailRows: when
      ? [{ label: 'When', value: when }, { label: 'Meeting', value: title }]
      : [{ label: 'Meeting', value: title }],
    ctaUrl: joinUrl,
    ctaLabel: 'Join now',
    secondaryHtml: when ? timezoneNoteHtml(timeZone) : '',
  });

  const attachments = [];
  if (scheduledStart) {
    const ics = meetingIcsAttachment({
      meetingId,
      title,
      startIso: scheduledStart,
      endIso: scheduledEnd,
      joinUrl,
    });
    if (ics) attachments.push(ics);
  }

  return { subject, text, html, attachments };
}

module.exports = { renderGuestInvite, renderGuestReminder, friendlyWhen };
