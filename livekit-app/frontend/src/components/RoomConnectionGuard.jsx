import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState, DisconnectReason, RoomEvent } from 'livekit-client';
import toast from 'react-hot-toast';

const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BASE_MS = 800;

/**
 * Handles unexpected disconnects with token refresh + reconnect.
 * Intentional leave (leave button) should set intentionalLeaveRef before room.disconnect().
 *
 * Also surfaces LiveKit's built-in reconnect (Reconnecting/Reconnected) so a brief
 * network blip shows "Reconnecting…" and we don't leave a zombie UI that looks
 * connected while mic/camera/data channels are dead.
 */
export default function RoomConnectionGuard({
  intentionalLeaveRef,
  reconnectingRef,
  onFetchToken,
  onReconnected,
  onGiveUp,
  onReconnectingChange,
}) {
  const room = useRoomContext();
  const attemptsRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!room) return undefined;

    const setReconnectingUi = (value) => {
      if (reconnectingRef) reconnectingRef.current = value;
      onReconnectingChange?.(value);
    };

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
        let limitMsg = '';
        try {
          limitMsg =
            sessionStorage.getItem('usage_limit_message_last') ||
            sessionStorage.getItem('usage_limit_message') ||
            '';
        } catch {
          /* ignore */
        }
        if (limitMsg) {
          toast.error(limitMsg, { duration: 8000 });
        } else {
          toast.error('Meeting ended');
        }
        onGiveUp?.(limitMsg || null);
        return;
      }

      busyRef.current = true;
      setReconnectingUi(true);

      while (attemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        if (intentionalLeaveRef?.current) break;
        attemptsRef.current += 1;
        const waitMs = Math.min(RECONNECT_BASE_MS * attemptsRef.current, 5000);
        await new Promise((r) => setTimeout(r, waitMs));
        try {
          // Drop a half-dead peer connection before connecting again.
          if (room.state !== ConnectionState.Disconnected) {
            try {
              await room.disconnect(true);
            } catch {
              /* ignore */
            }
          }

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
      setReconnectingUi(false);
    };

    const handleDisconnected = (reason) => {
      if (intentionalLeaveRef?.current) return;
      void tryReconnect(reason);
    };

    // LiveKit's internal ICE/signal recovery (brief blip) — show overlay, then
    // let PublishPreviewTracks restore media on RoomEvent.Reconnected.
    const handleReconnecting = () => {
      if (intentionalLeaveRef?.current) return;
      setReconnectingUi(true);
    };

    const handleReconnected = () => {
      if (intentionalLeaveRef?.current) return;
      attemptsRef.current = 0;
      setReconnectingUi(false);
      toast.success('Reconnected');
      onReconnected?.();
    };

    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.Reconnecting, handleReconnecting);
    room.on(RoomEvent.Reconnected, handleReconnected);
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.Reconnecting, handleReconnecting);
      room.off(RoomEvent.Reconnected, handleReconnected);
    };
  }, [
    room,
    intentionalLeaveRef,
    reconnectingRef,
    onFetchToken,
    onReconnected,
    onGiveUp,
    onReconnectingChange,
  ]);

  return null;
}
