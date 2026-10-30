import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';

function trackIsLive(publication) {
  const mst = publication?.track?.mediaStreamTrack;
  return Boolean(mst && mst.readyState === 'live');
}

/**
 * Demo safety net: ensure prejoin mic/camera actually publish after connect.
 * PublishPreviewTracks can miss if preview tracks were recreated on join.
 */
export default function DemoEnsureMedia({ audioEnabled, videoEnabled, audioDeviceId, videoDeviceId }) {
  const room = useRoomContext();
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!room) return undefined;

    const ensure = async () => {
      if (room.state !== ConnectionState.Connected) return;
      const lp = room.localParticipant;
      if (!lp) return;

      attemptsRef.current += 1;

      try {
        if (audioEnabled) {
          const micPub = lp.getTrackPublication(Track.Source.Microphone);
          if (!trackIsLive(micPub)) {
            await lp.setMicrophoneEnabled(
              true,
              audioDeviceId ? { deviceId: { exact: audioDeviceId } } : undefined,
            );
          }
        }

        if (videoEnabled) {
          const camPub = lp.getTrackPublication(Track.Source.Camera);
          if (!trackIsLive(camPub)) {
            await lp.setCameraEnabled(
              true,
              videoDeviceId ? { deviceId: { exact: videoDeviceId } } : undefined,
            );
          }
        }
      } catch (err) {
        console.warn('[DemoEnsureMedia] publish retry failed:', err);
      }
    };

    void ensure();
    room.on(RoomEvent.Connected, ensure);
    room.on(RoomEvent.Reconnected, ensure);
    room.on(RoomEvent.LocalTrackPublished, ensure);

    const interval = setInterval(() => {
      if (attemptsRef.current >= 8) {
        clearInterval(interval);
        return;
      }
      void ensure();
    }, 1500);

    return () => {
      room.off(RoomEvent.Connected, ensure);
      room.off(RoomEvent.Reconnected, ensure);
      room.off(RoomEvent.LocalTrackPublished, ensure);
      clearInterval(interval);
    };
  }, [room, audioEnabled, videoEnabled, audioDeviceId, videoDeviceId]);

  return null;
}
