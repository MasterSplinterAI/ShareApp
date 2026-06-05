import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { DisconnectReason, RoomEvent } from 'livekit-client';
import toast from 'react-hot-toast';

const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BASE_MS = 800;

/**
 * Handles unexpected disconnects with token refresh + reconnect.
 * Intentional leave (leave button) should set intentionalLeaveRef before room.disconnect().
 */
export default function RoomConnectionGuard({
  intentionalLeaveRef,
  reconnectingRef,
  onFetchToken,
  onReconnected,
  onGiveUp,
}) {
  const room = useRoomContext();
  const attemptsRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!room) return undefined;

    const tryReconnect = async (reason) => {
      if (intentionalLeaveRef?.current) return;
      if (busyRef.current) return;
      if (reason === DisconnectReason.CLIENT_INITIATED) return;
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        toast.error('You were removed from the meeting');
        onGiveUp?.();
        return;
      }
      if (reason === DisconnectReason.ROOM_DELETED) {
        toast.error('Meeting ended');
        onGiveUp?.();
        return;
      }

      busyRef.current = true;
      if (reconnectingRef) reconnectingRef.current = true;

      while (attemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        if (intentionalLeaveRef?.current) break;
        attemptsRef.current += 1;
        const waitMs = Math.min(RECONNECT_BASE_MS * attemptsRef.current, 5000);
        await new Promise((r) => setTimeout(r, waitMs));
        try {
          const { token, url } = await onFetchToken();
          if (!token) throw new Error('No token');
          const serverUrl =
            url || import.meta.env.VITE_LIVEKIT_URL || 'wss://production-uiycx4ku.livekit.cloud';
          await room.connect(serverUrl, token, { autoSubscribe: true });
          attemptsRef.current = 0;
          toast.success('Reconnected');
          onReconnected?.();
          break;
        } catch (e) {
          console.warn('[RoomConnectionGuard] reconnect attempt failed:', e?.message || e);
        }
      }

      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS && !intentionalLeaveRef?.current) {
        toast.error('Lost connection to the meeting');
        onGiveUp?.();
      }

      busyRef.current = false;
      if (reconnectingRef) reconnectingRef.current = false;
    };

    const onDisconnected = (reason) => {
      if (intentionalLeaveRef?.current) return;
      tryReconnect(reason);
    };

    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room, intentionalLeaveRef, reconnectingRef, onFetchToken, onReconnected, onGiveUp]);

  return null;
}
