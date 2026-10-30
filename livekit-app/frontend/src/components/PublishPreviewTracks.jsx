import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';

function trackIsLive(track) {
  const mst = track?.mediaStreamTrack;
  return Boolean(mst && mst.readyState === 'live');
}

function hasLivePublishedSource(localParticipant, source) {
  for (const publication of localParticipant.trackPublications.values()) {
    if (publication?.source !== source || !publication?.track) continue;
    const mst = publication.track.mediaStreamTrack;
    if (mst && mst.readyState === 'live') return true;
  }
  return false;
}

async function unpublishDeadSource(localParticipant, source) {
  for (const publication of [...localParticipant.trackPublications.values()]) {
    if (publication?.source !== source) continue;
    const mst = publication.track?.mediaStreamTrack;
    if (mst && mst.readyState === 'live') continue;
    try {
      if (publication.track) {
        await localParticipant.unpublishTrack(publication.track);
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Publishes the same LocalTracks acquired on the prejoin screen so background
 * processors (blur / virtual background) stay attached — avoids a multi-second
 * MediaPipe re-init when LiveKit would otherwise create fresh camera tracks.
 *
 * Also restores mic/camera after network reconnects. A previous bug left
 * publishedRef=true forever, so room.connect() after a blip showed you "in"
 * the meeting with no media and dead data channels.
 */
export default function PublishPreviewTracks({
  tracks,
  videoEnabled,
  audioEnabled,
  publishOptions,
}) {
  const room = useRoomContext();
  const publishingRef = useRef(false);

  useEffect(() => {
    if (!room) return undefined;

    const restoreMedia = async () => {
      if (room.state !== ConnectionState.Connected) return;
      if (publishingRef.current) return;

      const { localParticipant } = room;
      if (!localParticipant) return;

      publishingRef.current = true;
      try {
        const videoTrack = tracks?.find((t) => t.kind === Track.Kind.Video);
        const audioTrack = tracks?.find((t) => t.kind === Track.Kind.Audio);

        const needCamera =
          videoEnabled && !hasLivePublishedSource(localParticipant, Track.Source.Camera);
        const needMic =
          audioEnabled && !hasLivePublishedSource(localParticipant, Track.Source.Microphone);

        if (needCamera) {
          await unpublishDeadSource(localParticipant, Track.Source.Camera);
          if (videoTrack && trackIsLive(videoTrack)) {
            await localParticipant.publishTrack(videoTrack, {
              ...publishOptions,
              source: Track.Source.Camera,
            });
          } else {
            // Preview track died with the network blip — fall back to a fresh capture.
            await localParticipant.setCameraEnabled(true);
          }
        }

        if (needMic) {
          await unpublishDeadSource(localParticipant, Track.Source.Microphone);
          if (audioTrack && trackIsLive(audioTrack)) {
            await localParticipant.publishTrack(audioTrack, {
              source: Track.Source.Microphone,
            });
          } else {
            await localParticipant.setMicrophoneEnabled(true);
          }
        }
      } catch (err) {
        console.error('Failed to restore media after connect/reconnect:', err);
      } finally {
        publishingRef.current = false;
      }
    };

    if (room.state === ConnectionState.Connected) {
      void restoreMedia();
    }

    room.on(RoomEvent.Connected, restoreMedia);
    room.on(RoomEvent.Reconnected, restoreMedia);
    return () => {
      room.off(RoomEvent.Connected, restoreMedia);
      room.off(RoomEvent.Reconnected, restoreMedia);
    };
  }, [room, tracks, videoEnabled, audioEnabled, publishOptions]);

  return null;
}
