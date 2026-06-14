/**
 * Guest invite link expiry: presets anchored to the meeting lifecycle.
 */
const MS_HOUR = 3600000;
const MS_DAY = 86400000;

const MEETING_END_BUFFER_MS = Number(process.env.V2_INVITE_END_BUFFER_HOURS || 2) * MS_HOUR;
const DEFAULT_MEETING_DURATION_MS = Number(process.env.V2_DEFAULT_MEETING_DURATION_MIN || 60) * 60 * 1000;
const DAY_OF_MEETING_EARLY_MS = MS_HOUR;

const EXPIRY_MODES = new Set([
  'through_meeting',
  'day_of_meeting',
  'days_after_start',
  'custom_hours',
  'until_archived',
]);

const LINK_TYPES = new Set(['shared', 'single_use']);

function maxInviteTtlMs() {
  const days = Number(process.env.V2_MAX_INVITE_TTL_DAYS || 90);
  if (!Number.isFinite(days) || days <= 0) return 90 * MS_DAY;
  return Math.min(days, 365) * MS_DAY;
}

function clampInviteTtlMs(ms) {
  return Math.min(Math.max(0, ms), maxInviteTtlMs());
}

function defaultInviteTtlMs() {
  const days = Number(process.env.V2_DEFAULT_INVITE_TTL_DAYS || 7);
  const desired = (Number.isFinite(days) && days > 0 ? days : 7) * MS_DAY;
  return clampInviteTtlMs(desired);
}

function meetingAnchorMs(meeting) {
  const now = Date.now();
  const sched = meeting?.scheduled_start ? new Date(meeting.scheduled_start).getTime() : NaN;
  if (Number.isFinite(sched) && sched > now) return sched;
  return now;
}

function clampExpiresMs(meeting, targetMs) {
  const anchor = meetingAnchorMs(meeting);
  const cap = anchor + maxInviteTtlMs();
  return Math.min(targetMs, cap);
}

function defaultExpiryModeForMeeting(meeting) {
  if (meeting?.scheduled_start) {
    const t = new Date(meeting.scheduled_start).getTime();
    if (!Number.isNaN(t)) return 'through_meeting';
  }
  return 'days_after_start';
}

/**
 * @param {object} meeting - row with scheduled_start, scheduled_end, status
 * @param {object} opts
 * @param {string} [opts.mode]
 * @param {number} [opts.hours] - for custom_hours
 * @param {number} [opts.days] - for days_after_start
 */
function computeInviteExpiresAt(meeting, opts = {}) {
  const mode = EXPIRY_MODES.has(opts.mode) ? opts.mode : defaultExpiryModeForMeeting(meeting);
  const now = Date.now();

  switch (mode) {
    case 'through_meeting': {
      let endMs;
      if (meeting?.scheduled_end) {
        endMs = new Date(meeting.scheduled_end).getTime() + MEETING_END_BUFFER_MS;
      } else if (meeting?.scheduled_start) {
        const start = new Date(meeting.scheduled_start).getTime();
        endMs = start + DEFAULT_MEETING_DURATION_MS + MEETING_END_BUFFER_MS;
      } else {
        endMs = now + DEFAULT_MEETING_DURATION_MS + MEETING_END_BUFFER_MS;
      }
      return new Date(clampExpiresMs(meeting, endMs)).toISOString();
    }
    case 'day_of_meeting': {
      const start = meeting?.scheduled_start ? new Date(meeting.scheduled_start).getTime() : now;
      const dayEnd = new Date(start);
      dayEnd.setUTCHours(23, 59, 59, 999);
      return new Date(clampExpiresMs(meeting, dayEnd.getTime())).toISOString();
    }
    case 'days_after_start': {
      const days = Number.isFinite(Number(opts.days)) && Number(opts.days) > 0 ? Number(opts.days) : 7;
      const anchor = meetingAnchorMs(meeting);
      const ms = clampInviteTtlMs(days * MS_DAY);
      return new Date(anchor + ms).toISOString();
    }
    case 'custom_hours': {
      const hours = Number.isFinite(Number(opts.hours)) && Number(opts.hours) > 0 ? Number(opts.hours) : 168;
      const anchor = meetingAnchorMs(meeting);
      const ms = clampInviteTtlMs(hours * MS_HOUR);
      return new Date(anchor + ms).toISOString();
    }
    case 'until_archived': {
      const anchor = meetingAnchorMs(meeting);
      return new Date(anchor + maxInviteTtlMs()).toISOString();
    }
    default:
      return new Date(meetingAnchorMs(meeting) + defaultInviteTtlMs()).toISOString();
  }
}

function inviteEffectiveFromMs(meeting, inv) {
  if (inv?.expiry_mode === 'day_of_meeting' && meeting?.scheduled_start) {
    const start = new Date(meeting.scheduled_start).getTime();
    return start - DAY_OF_MEETING_EARLY_MS;
  }
  return null;
}

function inviteIsUsable(inv, meeting = null) {
  if (!inv || inv.revoked_at) return false;

  if (meeting) {
    if (meeting.status === 'archived') return false;
    if (['through_meeting', 'day_of_meeting'].includes(inv.expiry_mode) && meeting.status === 'ended') {
      return false;
    }
    if (inv.expiry_mode === 'until_archived' && meeting.status === 'archived') {
      return false;
    }
    const fromMs = inviteEffectiveFromMs(meeting, inv);
    if (fromMs != null && Date.now() < fromMs) return false;
  }

  const exp = new Date(inv.expires_at).getTime();
  if (Number.isNaN(exp) || exp < Date.now()) return false;
  if (inv.max_uses != null && inv.use_count >= inv.max_uses) return false;
  if (!inv.reusable && inv.use_count >= 1) return false;
  return true;
}

function expiryModeLabel(mode) {
  const labels = {
    through_meeting: 'Through end of meeting',
    day_of_meeting: 'Day of meeting',
    days_after_start: 'Days after start',
    custom_hours: 'Custom duration',
    until_archived: 'Until archived',
  };
  return labels[mode] || mode;
}

function linkTypeLabel(reusable) {
  return reusable ? 'Anyone with the link' : 'Single guest';
}

function describeInviteExpiry(inv, meeting) {
  const mode = inv?.expiry_mode || 'days_after_start';
  const exp = inv?.expires_at ? new Date(inv.expires_at) : null;
  const expStr = exp && !Number.isNaN(exp.getTime()) ? exp.toLocaleString('en-US') : '—';

  if (!inviteIsUsable(inv, meeting)) {
    if (inv?.revoked_at) return { short: 'Revoked', detail: 'This link was revoked.' };
    if (meeting?.status === 'archived') return { short: 'Meeting archived', detail: 'Link no longer valid.' };
    if (meeting?.status === 'ended' && ['through_meeting', 'day_of_meeting'].includes(mode)) {
      return { short: 'Meeting ended', detail: 'Link expired when the meeting ended.' };
    }
    return { short: 'Expired', detail: `Expired ${expStr}` };
  }

  switch (mode) {
    case 'through_meeting':
      return {
        short: 'Through end of meeting',
        detail: meeting?.scheduled_end
          ? `Valid until ${expStr} (${MEETING_END_BUFFER_MS / MS_HOUR}h after scheduled end)`
          : `Valid until ${expStr} (includes buffer after meeting)`,
      };
    case 'day_of_meeting':
      return {
        short: 'Day of meeting',
        detail: `Valid on meeting day until ${expStr}`,
      };
    case 'days_after_start': {
      return {
        short: 'Limited window after start',
        detail: `Valid until ${expStr}`,
      };
    }
    case 'custom_hours':
      return {
        short: 'Custom duration',
        detail: `Valid until ${expStr}`,
      };
    case 'until_archived':
      return {
        short: 'Until meeting archived',
        detail: `Valid until ${expStr} or when the meeting is archived (max ${Math.round(maxInviteTtlMs() / MS_DAY)} days)`,
      };
    default:
      return { short: 'Active', detail: `Valid until ${expStr}` };
  }
}

/** True when guests can still join (open room URL or at least one usable invite). */
function guestAccessActive(meeting, invites = [], requireInviteToken = true) {
  if (!requireInviteToken) {
    return meeting?.status !== 'ended' && meeting?.status !== 'archived';
  }
  if (!Array.isArray(invites) || invites.length === 0) return false;
  return invites.some((inv) => inviteIsUsable(inv, meeting));
}

function parseCreateInviteBody(body = {}, meeting) {
  const linkType = LINK_TYPES.has(body.linkType) ? body.linkType : 'shared';
  const reusable = linkType === 'shared';

  let mode = body.expiryMode;
  if (!EXPIRY_MODES.has(mode)) {
    if (body.expiresInHours != null) mode = 'custom_hours';
    else mode = defaultExpiryModeForMeeting(meeting);
  }

  const opts = { mode };
  if (mode === 'custom_hours') {
    opts.hours = Number(body.expiresInHours ?? body.hours ?? 168);
  }
  if (mode === 'days_after_start') {
    opts.days = Number(body.daysAfterStart ?? body.days ?? 7);
  }

  return { reusable, expiryMode: mode, opts, linkType };
}

module.exports = {
  EXPIRY_MODES,
  LINK_TYPES,
  MS_DAY,
  maxInviteTtlMs,
  defaultInviteTtlMs,
  defaultExpiryModeForMeeting,
  computeInviteExpiresAt,
  inviteIsUsable,
  guestAccessActive,
  inviteEffectiveFromMs,
  expiryModeLabel,
  linkTypeLabel,
  describeInviteExpiry,
  parseCreateInviteBody,
};
