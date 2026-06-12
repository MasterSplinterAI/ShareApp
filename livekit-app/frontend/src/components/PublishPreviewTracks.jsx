import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';

/**
 * Publishes the same LocalTracks acquired on the prejoin screen so background
 * processors (blur / virtual background) stay attached — avoids a multi-second
 * MediaPipe re-init when LiveKit would otherwise create fresh camera tracks.
 */
export default function PublishPreviewTracks({
  tracks,
  videoEnabled,
  audioEnabled,
  publishOptions,
}) {
  const room = useRoomContext();
  const publishedRef = useRef(false);

  useEffect(() => {
    if (!room || !tracks?.length) return undefined;

    const publish = async () => {
      if (publishedRef.current) return;
      if (room.state !== ConnectionState.Connected) return;

      const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video);
      const audioTrack = tracks.find((t) => t.kind === Track.Kind.Audio);
      if (!videoEnabled && !videoTrack && !audioEnabled && !audioTrack) return;

      publishedRef.current = true;
      const { localParticipant } = room;

      try {
        if (videoEnabled && videoTrack) {
          await localParticipant.publishTrack(videoTrack, {
            ...publishOptions,
            source: Track.Source.Camera,
          });
        }
        if (audioEnabled && audioTrack) {
          await localParticipant.publishTrack(audioTrack, {
            source: Track.Source.Microphone,
          });
        }
      } catch (err) {
        publishedRef.current = false;
        console.error('Failed to publish preview tracks:', err);
      }
    };

    if (room.state === ConnectionState.Connected) {
      publish();
    }

    room.on(RoomEvent.Connected, publish);
    return () => {
      room.off(RoomEvent.Connected, publish);
    };
  }, [room, tracks, videoEnabled, audioEnabled, publishOptions]);

  return null;
}
