import { useParticipantIds, useParticipant, useLocalParticipant, useMediaTrack } from '@daily-co/daily-react';
import { useEffect, useRef, useState } from 'react';

const ParticipantVideo = ({ sessionId, isLocal, isScreenShare = false }) => {
  const participant = useParticipant(sessionId);
  const videoRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Use Daily.co's useMediaTrack hook for proper track management
  // Fallback to participant tracks if useMediaTrack returns null
  const mediaTrackVideo = useMediaTrack(sessionId, isScreenShare ? 'screenVideo' : 'video');
  const mediaTrackAudio = useMediaTrack(sessionId, 'audio');
  
  // Use useMediaTrack if available, otherwise fall back to participant tracks
  const videoTrack = mediaTrackVideo || (isScreenShare ? participant?.screenVideoTrack : participant?.videoTrack);
  const audioTrack = mediaTrackAudio || participant?.audioTrack;

  useEffect(() => {
    if (!videoRef.current || !participant) return;

    // Check if tracks are valid MediaStreamTrack instances
    const hasVideoTrack = videoTrack && videoTrack instanceof MediaStreamTrack;
    const hasAudioTrack = audioTrack && audioTrack instanceof MediaStreamTrack;
    
    let stream = videoRef.current.srcObject;
    
    // Create or update stream with available tracks
    if (hasVideoTrack || (!isLocal && hasAudioTrack)) {
      if (!stream) {
        stream = new MediaStream();
        videoRef.current.srcObject = stream;
      }
      
      // Handle video track
      const currentVideoTracks = stream.getVideoTracks();
      if (hasVideoTrack) {
        // Remove old video tracks
        currentVideoTracks.forEach(track => {
          if (track !== videoTrack) {
            stream.removeTrack(track);
          }
        });
        // Add video track if not present
        if (!currentVideoTracks.includes(videoTrack)) {
          stream.addTrack(videoTrack);
        }
      } else {
        // Remove all video tracks
        currentVideoTracks.forEach(track => {
          stream.removeTrack(track);
        });
      }
      
      // Handle audio track (for remote participants only - local is handled by Daily.co)
      if (!isLocal && hasAudioTrack) {
        const currentAudioTracks = stream.getAudioTracks();
        // Remove old audio tracks
        currentAudioTracks.forEach(track => {
          if (track !== audioTrack) {
            stream.removeTrack(track);
          }
        });
        // Add audio track if not present
        if (!currentAudioTracks.includes(audioTrack)) {
          stream.addTrack(audioTrack);
        }
      } else if (!isLocal) {
        // Remove audio tracks if not available (remote only)
        const currentAudioTracks = stream.getAudioTracks();
        currentAudioTracks.forEach(track => {
          stream.removeTrack(track);
        });
      }
    } else {
      // No tracks - clear stream (but only for remote participants)
      // For local participants, keep stream alive even when no tracks (Daily.co manages audio)
      if (stream && !isLocal) {
        videoRef.current.srcObject = null;
      } else if (isLocal && !stream) {
        // Keep an empty stream for local participants to ensure audio continues
        stream = new MediaStream();
        videoRef.current.srcObject = stream;
      }
    }
  }, [videoTrack, audioTrack, participant, isScreenShare, isLocal]);

  const handleFullscreen = () => {
    if (!videoRef.current) return;

    if (!isFullscreen) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      } else if (videoRef.current.webkitRequestFullscreen) {
        videoRef.current.webkitRequestFullscreen();
      } else if (videoRef.current.mozRequestFullScreen) {
        videoRef.current.mozRequestFullScreen();
      } else if (videoRef.current.msRequestFullscreen) {
        videoRef.current.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const displayName = participant?.user_name || 'User';
  const micOn = participant?.audio;
  // Check if we have a valid video track
  const hasVideo = videoTrack && videoTrack instanceof MediaStreamTrack;
  
  // Debug logging
  useEffect(() => {
    if (isLocal) {
      console.log('Local participant video state:', {
        hasVideo,
        videoTrack: !!videoTrack,
        participantVideo: !!participant?.videoTrack,
        mediaTrackVideo: !!mediaTrackVideo,
        participant: !!participant
      });
    }
  }, [hasVideo, videoTrack, participant, isLocal, mediaTrackVideo]);

  // Don't return early - always render the full component so video element stays mounted
  // This ensures Daily.co can continue managing audio even when video is disabled

  return (
    <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video group">
      {/* Always render video element so ref stays consistent - keep it mounted even when video is off */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal && !isScreenShare}
        className={`w-full h-full object-cover ${hasVideo ? '' : 'hidden'}`}
        style={{ display: hasVideo ? 'block' : 'none' }}
        onLoadedMetadata={() => {
          // Ensure audio plays for remote participants
          if (!isLocal && videoRef.current && !videoRef.current.muted) {
            videoRef.current.play().catch(err => {
              console.log('Auto-play prevented, user interaction required:', err);
            });
          }
        }}
      />
      
      {/* Show placeholder when no video - always show for local participant when video is off */}
      {!hasVideo && (
        <div className="w-full h-full flex items-center justify-center bg-gray-700 absolute inset-0 z-10">
          <div className="text-center">
            <div className="w-20 h-20 bg-gray-600 rounded-full flex items-center justify-center mx-auto mb-2">
              <span className="text-2xl text-white">
                {displayName?.charAt(0)?.toUpperCase() || 'U'}
              </span>
            </div>
            <p className="text-white text-sm">{displayName || 'User'}</p>
          </div>
        </div>
      )}
      
      {/* Name Label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <p className="text-white text-sm font-medium">
          {isScreenShare ? `${displayName}'s Screen` : displayName} {isLocal && !isScreenShare && '(You)'}
        </p>
      </div>

      {/* Controls Overlay */}
      <div className="absolute top-2 left-2 flex gap-2">
        {!isScreenShare && (
          <>
            {/* Only show mic indicator if video is enabled OR if mic is off (to show muted state) */}
            {(hasVideo || !micOn) && (
              micOn ? (
                <div className="bg-green-500 rounded-full p-1.5">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                  </svg>
                </div>
              ) : (
                <div className="bg-red-500 rounded-full p-1.5">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )
            )}
          </>
        )}
        {isScreenShare && (
          <div className="bg-blue-500 rounded-full p-1.5">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
          </div>
        )}
      </div>

      {/* Fullscreen Button */}
      {hasVideo && (
        <button
          onClick={handleFullscreen}
          className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Fullscreen"
        >
          {isFullscreen ? (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6v12h12" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
};

// Component to render tiles for a participant (camera + screen share if available)
const ParticipantTiles = ({ sessionId, isLocal, localParticipant }) => {
  const participant = isLocal ? localParticipant : useParticipant(sessionId);
  
  return (
    <>
      {/* Camera tile */}
      <ParticipantVideo 
        key={`${sessionId}-camera`}
        sessionId={sessionId}
        isLocal={isLocal}
        isScreenShare={false}
      />
      
      {/* Screen share tile if available */}
      {participant?.screenVideoTrack && (
        <ParticipantVideo 
          key={`${sessionId}-screen`}
          sessionId={sessionId}
          isLocal={isLocal}
          isScreenShare={true}
        />
      )}
    </>
  );
};

const VideoGrid = () => {
  const participantIds = useParticipantIds();
  const localParticipant = useLocalParticipant();
  
  // Include local participant if it exists
  const allParticipantIds = localParticipant?.session_id 
    ? [localParticipant.session_id, ...participantIds.filter(id => id !== localParticipant.session_id)]
    : participantIds;

  // Count total tiles (camera + screen shares)
  const totalTiles = allParticipantIds.reduce((count, sessionId) => {
    const isLocal = localParticipant?.session_id === sessionId;
    const participant = isLocal ? localParticipant : null; // We'll check in component
    count++; // Camera tile
    // Check if has screen share (we'll render conditionally in component)
    return count;
  }, 0);

  // Responsive grid classes
  const getGridClasses = () => {
    // Estimate: assume at least one screen share might exist
    const estimatedCount = allParticipantIds.length * 1.5; // Rough estimate
    if (estimatedCount <= 1) return 'grid-cols-1';
    if (estimatedCount <= 2) return 'grid-cols-1 md:grid-cols-2';
    if (estimatedCount <= 4) return 'grid-cols-1 md:grid-cols-2';
    return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
  };

  if (allParticipantIds.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-white">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
          <p>Waiting for participants to join...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`grid ${getGridClasses()} gap-4 p-4 h-full overflow-auto`}>
      {allParticipantIds.map((sessionId) => {
        const isLocal = localParticipant?.session_id === sessionId;
        return (
          <ParticipantTiles
            key={sessionId}
            sessionId={sessionId}
            isLocal={isLocal}
            localParticipant={localParticipant}
          />
        );
      })}
    </div>
  );
};

export default VideoGrid;
