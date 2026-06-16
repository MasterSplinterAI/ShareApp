export const EXPIRY_MODE_OPTIONS = [
  { value: 'through_meeting', label: 'Through end of meeting', hint: 'Expires after the meeting ends (plus a short buffer).' },
  { value: 'day_of_meeting', label: 'Day of meeting', hint: 'Valid from one hour before start until end of that day (UTC).' },
  { value: 'days_after_start', label: '7 days after start', hint: 'Window measured from scheduled start, or from now if unscheduled.' },
  { value: 'custom_hours', label: 'Custom hours', hint: 'Set a custom duration from scheduled start (or now).' },
  { value: 'until_archived', label: 'Until archived', hint: 'Stays valid until the meeting is archived, up to the max TTL cap.' },
];

export const LINK_TYPE_OPTIONS = [
  { value: 'shared', label: 'Anyone with the link', hint: 'Reusable — multiple guests can use the same URL.' },
  { value: 'single_use', label: 'Single guest', hint: 'One-time link for a specific guest.' },
];

export function expiryModeLabel(mode) {
  return EXPIRY_MODE_OPTIONS.find((o) => o.value === mode)?.label || mode || 'Active';
}

export function linkTypeLabel(linkType) {
  return LINK_TYPE_OPTIONS.find((o) => o.value === linkType)?.label || linkType;
}

/** Presets available when creating a new invite (hide through_meeting if no schedule). */
export function expiryOptionsForMeeting(meeting) {
  const hasSchedule = Boolean(meeting?.scheduled_start);
  return EXPIRY_MODE_OPTIONS.filter((o) => hasSchedule || o.value !== 'through_meeting');
}

export function defaultExpiryMode(meeting) {
  if (meeting?.defaultExpiryMode) return meeting.defaultExpiryMode;
  return 'days_after_start';
}

export function inviteStatusLine(inv) {
  if (inv.revoked_at) return 'Revoked';
  if (!inv.usable) return inv.expiryLabel || 'Expired';
  const parts = [inv.expiryLabel || expiryModeLabel(inv.expiry_mode)];
  parts.push(`uses ${inv.use_count ?? 0}`);
  return parts.filter(Boolean).join(' · ');
}
