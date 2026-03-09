import { useState, useEffect, useRef, useCallback } from 'react';
import { useTracks, useParticipants, useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Maximize, Minimize, User } from 'lucide-react';
import { useMeeting } from '../context/MeetingContext';

function VideoGrid() {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const { isFullScreen, setIsFullScreen } = useMeeting();
  const fullScreenRef = useRef(null);
  const [focusedScreenShare, setFocusedScreenShare] = useState(null);

  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare, Track.Source.Microphone],
    { onlySubscribed: true }
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
  const videoRef = useRef(null);
  const { localParticipant } = useLocalParticipant();
  const isLocal = participant.identity === localParticipant?.identity;

  // Find this participant's camera track
  const cameraTrack = tracks.find(
    t => t.participant?.identity === participant.identity && t.source === Track.Source.Camera
  );

  // Find this participant's mic track for speaking indicator
  const micTrack = tracks.find(
    t => t.participant?.identity === participant.identity && t.source === Track.Source.Microphone
  );

  const hasVideo = cameraTrack?.track && !cameraTrack.track.isMuted;
  const isSpeaking = participant.isSpeaking;

  // Attach video track to element
  useEffect(() => {
    if (!videoRef.current || !cameraTrack?.track) return;

    const track = cameraTrack.track;
    track.attach(videoRef.current);

    return () => {
      track.detach(videoRef.current);
    };
  }, [cameraTrack?.track]);

  const displayName = participant.name || participant.identity || 'Unknown';

  return (
    <div
      className={`relative rounded-lg overflow-hidden bg-gray-800 ${
        compact ? 'w-36 sm:w-44 flex-shrink-0' : ''
      } ${isSpeaking ? 'ring-2 ring-green-400' : ''}`}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${isLocal ? '-scale-x-100' : ''}`}
        />
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

  useEffect(() => {
    if (!videoRef.current || !track?.track) return;

    const mediaTrack = track.track;
    mediaTrack.attach(videoRef.current);

    return () => {
      mediaTrack.detach(videoRef.current);
    };
  }, [track?.track]);

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
