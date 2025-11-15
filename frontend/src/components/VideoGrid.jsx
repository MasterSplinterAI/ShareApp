import { useParticipantIds, useParticipant, useLocalParticipant } from '@daily-co/daily-react';
import { useEffect, useRef } from 'react';

const ParticipantVideo = ({ sessionId, isLocal }) => {
  const participant = useParticipant(sessionId);
  const videoRef = useRef(null);
  const screenRef = useRef(null);

  useEffect(() => {
    if (!videoRef.current || !participant) return;

    // Prioritize screen share if available, otherwise use camera video
    const videoTrack = participant.screenVideoTrack || participant.videoTrack;
    
    if (videoTrack) {
      videoRef.current.srcObject = new MediaStream([videoTrack]);
    } else {
      videoRef.current.srcObject = null;
    }
  }, [participant?.videoTrack, participant?.screenVideoTrack]);

  // Separate screen share display (optional - can show both)
  useEffect(() => {
    if (!screenRef.current || !participant) return;

    if (participant.screenVideoTrack && participant.videoTrack) {
      // If both screen and camera, show screen in separate element
      screenRef.current.srcObject = new MediaStream([participant.screenVideoTrack]);
    } else {
      screenRef.current.srcObject = null;
    }
  }, [participant?.screenVideoTrack]);

  const displayName = participant?.user_name || 'User';
  const micOn = participant?.audio;
  const hasVideo = participant?.video || participant?.screenVideo;
  const isScreenSharing = !!participant?.screenVideoTrack;

  return (
    <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
      {hasVideo ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className="w-full h-full object-cover"
          />
          {isScreenSharing && participant?.videoTrack && (
            <div className="absolute top-2 right-2 w-24 h-16 bg-gray-900 rounded border-2 border-blue-500 overflow-hidden">
              <video
                ref={screenRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-700">
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
          {displayName || 'User'} {isLocal && '(You)'}
        </p>
      </div>

      {/* Mic Status */}
      <div className="absolute top-2 left-2 flex gap-2">
        {micOn ? (
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
        )}
        {isScreenSharing && (
          <div className="bg-blue-500 rounded-full p-1.5">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

const VideoGrid = () => {
  const participantIds = useParticipantIds();
  const localParticipant = useLocalParticipant();
  
  // Include local participant if it exists
  const allParticipantIds = localParticipant?.session_id 
    ? [localParticipant.session_id, ...participantIds.filter(id => id !== localParticipant.session_id)]
    : participantIds;

  // Responsive grid classes
  const getGridClasses = () => {
    const count = allParticipantIds.length;
    if (count === 1) return 'grid-cols-1';
    if (count === 2) return 'grid-cols-1 md:grid-cols-2';
    if (count <= 4) return 'grid-cols-1 md:grid-cols-2';
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
          <ParticipantVideo 
            key={sessionId} 
            sessionId={sessionId}
            isLocal={isLocal}
          />
        );
      })}
    </div>
  );
};

export default VideoGrid;

