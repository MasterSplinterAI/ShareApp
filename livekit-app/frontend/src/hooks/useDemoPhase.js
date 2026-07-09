import { useEffect, useState } from 'react';
import { ConnectionState } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';

/**
 * Turn-taking UI driven by the translation agent's demo_phase packets (topic: demo).
 * Falls back to your_turn if the agent never advances past opening.
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

  // Don't block the user forever if opening orchestration fails or is slow.
  useEffect(() => {
    if (turnPhase !== 'opening') return undefined;
    const t = setTimeout(() => setTurnPhase('your_turn'), 10000);
    return () => clearTimeout(t);
  }, [turnPhase]);

  useEffect(() => {
    if (!room || room.state !== ConnectionState.Connected) return undefined;
    const t = setTimeout(() => {
      setTurnPhase((phase) => (phase === 'opening' ? 'your_turn' : phase));
    }, 8000);
    return () => clearTimeout(t);
  }, [room, room?.state]);

  return { turnPhase, setTurnPhase, activeSpeaker, setActiveSpeaker };
}
