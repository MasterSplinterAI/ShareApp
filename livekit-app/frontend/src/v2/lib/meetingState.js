/**
 * UI labels for V2 meeting rows (status + optional policy hints).
 */
export function getMeetingUiState(meeting, extras = {}) {
  const now = Date.now();
  const s = meeting.status;
  if (s === 'archived') {
    return { label: 'Archived', tone: 'gray', key: 'archived' };
  }
  if (s === 'ended') {
    return { label: 'Ended', tone: 'gray', key: 'ended' };
  }
  if (s === 'scheduled' && meeting.scheduled_start) {
    const t = new Date(meeting.scheduled_start).getTime();
    if (!Number.isNaN(t) && t > now) {
      return { label: 'Scheduled', tone: 'blue', key: 'scheduled' };
    }
  }
  if (s === 'scheduled') {
    return { label: 'Scheduled', tone: 'blue', key: 'scheduled' };
  }
  if (s === 'live') {
    if (extras.waitingForHost || (meeting.host_required_to_start === 1 && meeting.host_present === 0)) {
      return { label: 'Waiting for host', tone: 'amber', key: 'waiting_for_host' };
    }
    return { label: 'Live', tone: 'green', key: 'live' };
  }
  return { label: s || 'Unknown', tone: 'gray', key: 'unknown' };
}

export function toneClasses(tone) {
  switch (tone) {
    case 'green':
      return 'text-emerald-400 bg-emerald-950/40 border-emerald-800';
    case 'blue':
      return 'text-sky-400 bg-sky-950/40 border-sky-800';
    case 'amber':
      return 'text-amber-400 bg-amber-950/40 border-amber-800';
    default:
      return 'text-gray-400 bg-gray-800/50 border-gray-700';
  }
}
