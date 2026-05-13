/**
 * UI labels for V2 meeting rows (status + optional policy hints).
 */
export function getMeetingUiState(meeting, extras = {}) {
  const now = Date.now();
  const s = meeting.status;
  const inRoom = Number(meeting.roomPresence?.humanCount ?? meeting.room_human_count ?? extras.roomHumanCount ?? 0);
  if (s === 'archived') {
    return { label: 'Archived', tone: 'gray', key: 'archived' };
  }
  if (s === 'ended') {
    return { label: 'Ended', tone: 'gray', key: 'ended' };
  }
  if (s === 'scheduled' && meeting.scheduled_start) {
    const t = new Date(meeting.scheduled_start).getTime();
    if (!Number.isNaN(t) && t > now) {
      return inRoom > 0
        ? { label: `Live · ${inRoom} in room`, tone: 'green', key: 'scheduled_active' }
        : { label: 'Ready', tone: 'blue', key: 'scheduled_ready' };
    }
  }
  if (s === 'scheduled') {
    return inRoom > 0
      ? { label: `Live · ${inRoom} in room`, tone: 'green', key: 'scheduled_active' }
      : { label: 'Ready', tone: 'blue', key: 'scheduled_ready' };
  }
  if (s === 'live') {
    if (extras.waitingForHost || (meeting.host_required_to_start === 1 && meeting.host_present === 0)) {
      return { label: 'Waiting for host', tone: 'amber', key: 'waiting_for_host' };
    }
    if (inRoom > 0) {
      return { label: `Live · ${inRoom} in room`, tone: 'green', key: 'live_active' };
    }
    return { label: 'Ready', tone: 'sky', key: 'live_ready' };
  }
  return { label: s || 'Unknown', tone: 'gray', key: 'unknown' };
}

export function toneClasses(tone) {
  switch (tone) {
    case 'green':
      return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'blue':
      return 'text-sky-700 bg-sky-50 border-sky-200';
    case 'sky':
      return 'text-sky-700 bg-sky-50 border-sky-200';
    case 'amber':
      return 'text-amber-700 bg-amber-50 border-amber-200';
    default:
      return 'text-muted-foreground bg-muted border-border';
  }
}

/** Maps meeting UI tone to shadcn Badge variant (use with `<Badge variant={toneToBadgeVariant(ui.tone)}>`). */
export function toneToBadgeVariant(tone) {
  switch (tone) {
    case 'green':
      return 'success';
    case 'blue':
    case 'sky':
      return 'info';
    case 'amber':
      return 'warning';
    default:
      return 'muted';
  }
}
