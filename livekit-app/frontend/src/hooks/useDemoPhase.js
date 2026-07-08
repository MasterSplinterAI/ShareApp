import { useEffect, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';

/**
 * Turn-taking UI driven by the translation agent's demo_phase packets (topic: demo).
 */
export function useDemoPhase() {
  const room = useRoomContext();
  const [turnPhase, setTurnPhase] = useState('opening');
  const [activeSpeaker, setActiveSpeaker] = useState(null);

  useEffect(() => {
    if (!room) return;

    const handleData = (payload, _participant, _kind, topic) => {
      if (topic != null && topic !== 'demo') return;
      try {
        const raw = payload instanceof Uint8Array ? payload : payload?.data ?? payload;
        if (!raw) return;
        const message = JSON.parse(new TextDecoder().decode(raw));
        if (message.type !== 'demo_phase') return;
        if (message.phase) setTurnPhase(message.phase);
        setActiveSpeaker(message.activeSpeaker || null);
      } catch {
        /* ignore */
      }
    };

    room.on('dataReceived', handleData);
    return () => room.off('dataReceived', handleData);
  }, [room]);

  return { turnPhase, setTurnPhase, activeSpeaker, setActiveSpeaker };
}
