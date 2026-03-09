import { useState, useEffect, useRef, useCallback } from 'react';
import { useTracks, useParticipants, useLocalParticipant, VideoTrack, ParticipantContext } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Maximize, Minimize, User, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useMeeting } from '../context/MeetingContext';

function VideoGrid() {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const { isFullScreen, setIsFullScreen } = useMeeting();
  const fullScreenRef = useRef(null);
  const [focusedScreenShare, setFocusedScreenShare] = useState(null);

  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare, Track.Source.Microphone],
    { onlySubscribed: false }
  );

  // Filter out agent participants — they have no video to show
  const humanParticipants = participants.filter(p => {
    const identity = p.identity || '';
    return !identity.startsWith('agent-') &&
           !identity.includes('translation-bot') &&
           p.metadata?.role !== 'agent';
  });

  // Find screen share tracks
  const screenShareTracks = tracks.filter(t => t.source === Track.Source.ScreenShare);
  const activeScreenShare = screenShareTracks.length > 0 ? screenShareTracks[0] : null;

  // Handle full screen toggle
  const toggleFullScreen = useCallback(async () => {
    if (!fullScreenRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await fullScreenRef.current.requestFullscreen();
        setIsFullScreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullScreen(false);
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  }, [setIsFullScreen]);

  // Listen for fullscreen changes (user pressing Escape, etc.)
  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, [setIsFullScreen]);

  // Determine grid columns based on participant count
  const getGridClass = (count) => {
    if (count <= 1) return 'grid-cols-1';
    if (count <= 2) return 'grid-cols-1 sm:grid-cols-2';
    if (count <= 4) return 'grid-cols-2';
    if (count <= 6) return 'grid-cols-2 sm:grid-cols-3';
    return 'grid-cols-3 sm:grid-cols-4';
  };

  // If there's an active screen share, use focus layout
  if (activeScreenShare) {
    return (
      <div ref={fullScreenRef} className="flex flex-col h-full w-full bg-gray-900">
        {/* Screen share - main area */}
        <div className="flex-1 min-h-0 relative">
          <VideoTrackRenderer
            track={activeScreenShare}
            className="w-full h-full object-contain bg-black"
          />
          <button
            onClick={toggleFullScreen}
            className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg transition-all z-10"
            title={isFullScreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullScreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>

        {/* Participant strip - bottom */}
        {!isFullScreen && (
          <div className="h-28 sm:h-36 flex gap-2 p-2 overflow-x-auto bg-gray-900/95">
            {humanParticipants.map(participant => (
              <ParticipantTile
                key={participant.identity}
                participant={participant}
                tracks={tracks}
                compact
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Normal grid layout
  return (
    <div ref={fullScreenRef} className="h-full w-full p-2 sm:p-3 bg-gray-900">
      <div className={`grid ${getGridClass(humanParticipants.length)} gap-2 sm:gap-3 h-full auto-rows-fr`}>
        {humanParticipants.map(participant => (
          <ParticipantTile
            key={participant.identity}
            participant={participant}
            tracks={tracks}
          />
        ))}
      </div>
    </div>
  );
}

function ParticipantTile({ participant, tracks, compact = false }) {
  const { localParticipant, cameraTrack: localCameraPub, microphoneTrack: localMicPub, isCameraEnabled: localCameraEnabled } = useLocalParticipant();
  const isLocal = participant.identity === localParticipant?.identity;

  // For local participant: use useLocalParticipant's cameraTrack directly (useTracks can lag)
  // For remote: find in tracks from useTracks
  const cameraTrackRef = isLocal && localCameraPub
    ? { participant: localParticipant, publication: localCameraPub, source: Track.Source.Camera }
    : tracks.find(
        t => t.participant?.identity === participant.identity && t.source === Track.Source.Camera
      );

  const micPub = participant.getTrackPublication?.(Track.Source.Microphone) ?? (isLocal ? localMicPub : tracks.find(t => t.participant?.identity === participant.identity && t.source === Track.Source.Microphone)?.publication);
  const camPub = cameraTrackRef?.publication ?? participant.getTrackPublication?.(Track.Source.Camera);

  const hasVideo = !!(cameraTrackRef?.publication?.track);
  const isMicMuted = micPub?.isMuted ?? true;
  // Camera: local uses isCameraEnabled; remote uses hasVideo (no track = off)
  const isCameraOff = isLocal ? !localCameraEnabled : !hasVideo;
  const isSpeaking = participant.isSpeaking;

  const displayName = participant.name || participant.identity || 'Unknown';

  return (
    <div
      className={`relative rounded-lg overflow-hidden bg-gray-800 aspect-video min-h-0 ${
        compact ? 'w-36 sm:w-44 flex-shrink-0' : ''
      } ${isSpeaking ? 'ring-2 ring-green-400' : ''}`}
    >
      {hasVideo ? (
        <ParticipantContext.Provider value={participant}>
          <VideoTrack
            trackRef={cameraTrackRef}
            muted={isLocal}
            playsInline
            className={`w-full h-full min-h-0 object-cover ${isLocal ? '-scale-x-100' : ''}`}
          />
        </ParticipantContext.Provider>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-800">
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gray-700 flex items-center justify-center">
              <User className="w-8 h-8 sm:w-10 sm:h-10 text-gray-400" />
            </div>
          </div>
        </div>
      )}

      {/* Name label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <span className="text-white text-sm font-medium truncate block" data-no-translate="true">
          {displayName}
          {isLocal && ' (You)'}
        </span>
      </div>

      {/* Mic/camera status indicators */}
      <div className="absolute top-2 left-2 flex items-center gap-1">
        {isMicMuted ? (
          <span className="p-1 rounded bg-red-500/80" title="Microphone off">
            <MicOff className="w-3.5 h-3.5 text-white" />
          </span>
        ) : (
          <span className="p-1 rounded bg-green-500/80" title="Microphone on">
            <Mic className="w-3.5 h-3.5 text-white" />
          </span>
        )}
        {isCameraOff ? (
          <span className="p-1 rounded bg-red-500/80" title="Camera off">
            <VideoOff className="w-3.5 h-3.5 text-white" />
          </span>
        ) : (
          <span className="p-1 rounded bg-green-500/80" title="Camera on">
            <Video className="w-3.5 h-3.5 text-white" />
          </span>
        )}
      </div>

      {/* Speaking indicator */}
      {isSpeaking && (
        <div className="absolute top-2 right-2">
          <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
        </div>
      )}
    </div>
  );
}

function VideoTrackRenderer({ track, className = '' }) {
  const videoRef = useRef(null);
  const mediaTrack = track?.publication?.track;

  useEffect(() => {
    if (!videoRef.current || !mediaTrack) return;

    mediaTrack.attach(videoRef.current);

    return () => {
      mediaTrack.detach(videoRef.current);
    };
  }, [mediaTrack]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className={className}
    />
  );
}

export default VideoGrid;
