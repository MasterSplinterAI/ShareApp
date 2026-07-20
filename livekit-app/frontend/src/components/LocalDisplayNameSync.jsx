import { useEffect } from 'react';
import { useRoomContext } from '@livekit/components-react';

/**
 * Ensure the local LiveKit participant publishes the typed display name.
 * Guest tokens already embed `name` in the JWT; this covers clients/servers
 * that leave `participant.name` empty and only expose identity (`guest-…`).
 */
export default function LocalDisplayNameSync({ displayName }) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room || room.state !== 'connected') return undefined;
    const name = String(displayName || '').trim();
    if (!name) return undefined;

    const lp = room.localParticipant;
    if (!lp) return undefined;

    let cancelled = false;
    (async () => {
      try {
        if (lp.name !== name) {
          await lp.setName(name);
        }
        const role = String(lp.identity || '').startsWith('guest-') ? 'guest' : 'member';
        let nextMeta = { displayName: name, role };
        try {
          if (lp.metadata) {
            const prev = JSON.parse(lp.metadata);
            if (prev && typeof prev === 'object') nextMeta = { ...prev, ...nextMeta };
          }
        } catch {
          /* replace invalid metadata */
        }
        const encoded = JSON.stringify(nextMeta);
        if (lp.metadata !== encoded) {
          await lp.setMetadata(encoded);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[LocalDisplayNameSync] failed to publish display name:', err?.message || err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [room, room?.state, displayName]);

  return null;
}
