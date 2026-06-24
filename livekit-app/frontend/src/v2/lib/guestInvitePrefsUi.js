/** Preset reminder offsets (minutes before meeting start). */
export const REMINDER_DAY_BEFORE = 1440;
export const REMINDER_FIFTEEN_MIN = 15;

export function detectBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function reminderOffsetLabel(offsetMin) {
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

export function rsvpStatusLabel(status) {
  switch (status) {
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'tentative':
      return 'Maybe';
    case 'needs_action':
      return 'Awaiting';
    default:
      return null;
  }
}

export function offsetsFromToggles({ dayBefore, fifteenMin }) {
  const offsets = [];
  if (dayBefore) offsets.push(REMINDER_DAY_BEFORE);
  if (fifteenMin) offsets.push(REMINDER_FIFTEEN_MIN);
  return offsets;
}

export function togglesFromOffsets(offsets = []) {
  const set = new Set(offsets);
  return {
    dayBefore: set.has(REMINDER_DAY_BEFORE),
    fifteenMin: set.has(REMINDER_FIFTEEN_MIN),
  };
}

/** Common IANA timezones for account settings (browser TZ added at runtime). */
export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function timezoneOptions(current) {
  const browser = detectBrowserTimezone();
  const base = [...COMMON_TIMEZONES];
  if (browser && !base.includes(browser)) base.unshift(browser);
  if (current && !base.includes(current)) base.unshift(current);
  return base;
}
