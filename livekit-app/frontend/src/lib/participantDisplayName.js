/**
 * Resolve a human-readable name for a LiveKit participant.
 * Guest tokens use identity `guest-{uuid}` for security; the typed name lives in
 * `participant.name` and/or metadata.displayName.
 */
export function isWeakDisplayLabel(label) {
  const s = String(label || '').trim();
  if (!s) return true;
  if (s === 'Guest' || s === 'Unknown') return true;
  return /^guest-[0-9a-f-]{36}$/i.test(s);
}

/** Prefer a real typed name over guest-uuid / generic fallbacks. */
export function preferSpeakerLabel(incoming, existing) {
  if (!isWeakDisplayLabel(incoming)) return String(incoming).trim();
  if (!isWeakDisplayLabel(existing)) return String(existing).trim();
  return String(incoming || existing || '').trim();
}

export function participantDisplayName(participant) {
  if (!participant) return 'Unknown';
  const identity = String(participant.identity || '');
  const name = String(participant.name || '').trim();
  if (name && name !== identity) return name;

  try {
    const raw = participant.metadata;
    if (raw) {
      const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const fromMeta = String(meta?.displayName || meta?.name || '').trim();
      if (fromMeta) return fromMeta;
    }
  } catch {
    /* ignore bad metadata */
  }

  if (/^guest-[0-9a-f-]{36}$/i.test(identity)) return 'Guest';
  return name || identity || 'Unknown';
}

/** Map a speaker identity (e.g. from caption packets) to a display label. */
export function resolveSpeakerLabel(speakerId, room) {
  if (!speakerId) return 'Unknown';
  const id = String(speakerId);
  if (!room) {
    return /^guest-[0-9a-f-]{36}$/i.test(id) ? 'Guest' : id;
  }

  const local = room.localParticipant;
  if (local?.identity === id) return participantDisplayName(local);

  const byApi = typeof room.getParticipantByIdentity === 'function'
    ? room.getParticipantByIdentity(id)
    : null;
  if (byApi) return participantDisplayName(byApi);

  for (const p of room.remoteParticipants?.values?.() || []) {
    if (p.identity === id) return participantDisplayName(p);
  }

  return /^guest-[0-9a-f-]{36}$/i.test(id) ? 'Guest' : id;
}
