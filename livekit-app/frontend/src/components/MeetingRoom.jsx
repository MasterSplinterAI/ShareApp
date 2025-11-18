import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { LiveKitRoom, VideoConference, formatChatMessageLinks, useRoomContext } from '@livekit/components-react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { authService, roomService } from '../services/api';
import ShareModal from './ShareModal';
import LanguageSelector from './LanguageSelector';
import TranscriptionDisplay from './TranscriptionDisplay';
import RoomControls from './RoomControls';

function MeetingRoom() {
  console.log('MeetingRoom: Component function called');
  
  const { roomName } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  
  console.log('MeetingRoom: roomName from useParams:', roomName);
  console.log('MeetingRoom: location.pathname:', location.pathname);
  console.log('MeetingRoom: location.state:', location.state);
  
  const [token, setToken] = useState(null);
  const [livekitUrl, setLivekitUrl] = useState(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [error, setError] = useState(null);
  const [participantInfo, setParticipantInfo] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [roomMode, setRoomMode] = useState('multi-language'); // '2-languages' or 'multi-language'
  
  console.log('MeetingRoom: State initialized, isInitialized:', isInitialized, 'participantInfo:', participantInfo);

  // Initialize participant info on mount
  useEffect(() => {
    console.log('MeetingRoom: Initializing...');
    console.log('MeetingRoom: roomName from params:', roomName);
    console.log('MeetingRoom: location.state:', location.state);
    
    // Get participant info from navigation state or sessionStorage
    const stateInfo = location.state || {};
    let sessionInfo = {};
    
    try {
      const sessionData = sessionStorage.getItem('participantInfo');
      console.log('MeetingRoom: Raw sessionStorage data:', sessionData);
      if (sessionData) {
        sessionInfo = JSON.parse(sessionData);
        console.log('MeetingRoom: Parsed sessionStorage info:', sessionInfo);
      }
    } catch (e) {
      console.error('MeetingRoom: Error parsing sessionStorage:', e);
    }
    
    // Check if sessionStorage roomName matches current roomName
    if (sessionInfo.roomName && sessionInfo.roomName !== roomName) {
      console.warn('MeetingRoom: Room name mismatch! Session:', sessionInfo.roomName, 'Current:', roomName);
      // Clear mismatched session data
      sessionStorage.removeItem('participantInfo');
      sessionInfo = {};
    }
    
    // Prefer location.state but fall back to sessionStorage
    const participantName = stateInfo.participantName || sessionInfo.participantName;
    const isHost = stateInfo.isHost !== undefined ? stateInfo.isHost : (sessionInfo.isHost !== undefined ? sessionInfo.isHost : false);
    const hostCode = stateInfo.hostCode || sessionInfo.hostCode;
    const shareableLink = stateInfo.shareableLink || sessionInfo.shareableLink;
    const shareableLinkNetwork = stateInfo.shareableLinkNetwork || sessionInfo.shareableLinkNetwork;
    // Get roomMode from state/sessionStorage, or fetch from room if not available
    let roomModeFromState = stateInfo.roomMode || sessionInfo.roomMode;
    
    console.log('MeetingRoom: Resolved participantName:', participantName);
    console.log('MeetingRoom: isHost:', isHost);
    console.log('MeetingRoom: roomMode from state/session:', roomModeFromState);
    
    // If roomMode not in state/sessionStorage, fetch it from room metadata
    if (!roomModeFromState && roomName) {
      // Fetch room info to get roomMode
      roomService.getInfo(roomName).then(info => {
        if (info.roomMode) {
          setRoomMode(info.roomMode);
          console.log('MeetingRoom: Fetched roomMode from room:', info.roomMode);
        }
      }).catch(err => {
        console.warn('MeetingRoom: Could not fetch room info for roomMode:', err);
        // Default to multi-language if fetch fails
        setRoomMode('multi-language');
      });
      // Use default while fetching
      roomModeFromState = 'multi-language';
    }
    
    if (!roomModeFromState) {
      roomModeFromState = 'multi-language'; // Default fallback
    }
    
    if (!participantName) {
      // No name provided, redirect to join page
      console.log('MeetingRoom: No participant name found, redirecting to join page');
      navigate(`/join/${roomName}`, { replace: true });
      return;
    }
    
    // Set participant info
    console.log('MeetingRoom: Setting participant info...');
    setParticipantInfo({
      participantName,
      isHost,
      hostCode,
      shareableLink,
      shareableLinkNetwork
    });
    setRoomMode(roomModeFromState);
    setIsInitialized(true);
    
    console.log('MeetingRoom: Participant info set, ready to connect');
  }, [roomName, navigate]); // Removed location.state from deps to prevent re-runs

  // Connect to room once initialized
  useEffect(() => {
    if (!isInitialized || !participantInfo) {
      console.log('MeetingRoom: Not yet initialized or no participant info');
      return;
    }
    
    console.log('MeetingRoom: Connecting to room with participant:', participantInfo.participantName);
    connectToRoom();
  }, [isInitialized, participantInfo]);

  // Don't clear sessionStorage on unmount - let it persist for the session
  // It will be cleared when user explicitly leaves or joins a new room

  const connectToRoom = async () => {
    if (!participantInfo) {
      console.error('MeetingRoom: No participant info available');
      return;
    }
    
    try {
      const tokenData = await authService.getToken(
        roomName, 
        participantInfo.participantName, 
        participantInfo.isHost
      );
      console.log('Token data received:', tokenData);
      console.log('Token type:', typeof tokenData.token);
      console.log('Token value:', tokenData.token);
      
      if (!tokenData.token || typeof tokenData.token !== 'string') {
        throw new Error('Invalid token received from server');
      }
      
      setToken(tokenData.token);
      // Use the URL from the token response (always correct)
      if (tokenData.url) {
        setLivekitUrl(tokenData.url);
      }
    } catch (error) {
      console.error('Failed to get token:', error);
      setError(error.response?.data?.error || 'Failed to connect to room');
      toast.error('Failed to connect to room');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnected = () => {
    toast('Disconnected from room');
    navigate('/');
  };

  // Cleanup: Suppress harmless WebRTC errors during disconnect
  useEffect(() => {
    // Suppress "could not createOffer with closed peer connection" errors
    // This is a harmless race condition during cleanup
    const originalError = console.error;
    const errorHandler = (...args) => {
      const errorMsg = args.join(' ');
      if (errorMsg.includes('could not createOffer') || 
          errorMsg.includes('closed peer connection') ||
          errorMsg.includes('PC manager is closed')) {
        // Suppress this harmless error
        return;
      }
      originalError(...args);
    };
    
    // Only suppress in development to avoid hiding real errors
    if (import.meta.env.DEV) {
      console.error = errorHandler;
    }
    
    return () => {
      if (import.meta.env.DEV) {
        console.error = originalError;
      }
    };
  }, []);

  // Cleanup: Ensure proper disconnection when component unmounts
  useEffect(() => {
    return () => {
      // Component is unmounting - cleanup will happen automatically via LiveKitRoom
      // The error suppression above will handle any race condition errors
    };
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  // Wait for participant info to be initialized
  if (!isInitialized || !participantInfo) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-300">Loading participant info...</p>
        </div>
      </div>
    );
  }

  if (isConnecting || !token) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-300">Connecting to room...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-900 relative">
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={livekitUrl || import.meta.env.VITE_LIVEKIT_URL || 'wss://production-uiycx4ku.livekit.cloud'}
        onDisconnected={handleDisconnected}
        data-lk-theme="default"
        className="h-full"
      >
        <TrackFilter roomMode={roomMode} />
        <VideoConference 
          chatMessageFormatter={formatChatMessageLinks}
        />
        
        {/* Room controls for handling translation data */}
        <RoomControls 
          selectedLanguage={selectedLanguage}
          translationEnabled={translationEnabled}
          participantName={participantInfo?.participantName || ''}
        />
        
        {/* Custom Control Bar at Bottom - Language Selector and Share Button */}
        {/* Positioned at bottom, aligned with LiveKit's control bar */}
        <div className="lk-control-bar-custom">
          {/* Language Selector */}
          <LanguageSelector
            value={selectedLanguage}
            onChange={setSelectedLanguage}
            onTranslationToggle={() => setTranslationEnabled(!translationEnabled)}
            translationEnabled={translationEnabled}
          />
          
          {/* Share Button - Host Only */}
          {participantInfo?.isHost && (
            <button
              onClick={() => setShowShareModal(true)}
              className="lk-share-button"
              title="Share meeting link"
              aria-label="Share meeting"
            >
              <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              <span className="lk-share-button-text">Share</span>
            </button>
          )}
        </div>
        
        {/* Transcription Display */}
        {translationEnabled && (
          <TranscriptionDisplay
            participantId={participantInfo?.participantName || ''}
            isVisible={true}
          />
        )}
      </LiveKitRoom>

      {/* Share Modal */}
      {showShareModal && (
        <ShareModal
          shareableLink={participantInfo?.shareableLink || `${window.location.origin}/join/${roomName}`}
          shareableLinkNetwork={participantInfo?.shareableLinkNetwork}
          hostCode={participantInfo?.hostCode}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}

// Component to filter translation tracks based on room mode
// - 'multi-language': Each participant only hears their own translations (filtered)
// - '2-languages': Everyone hears all translations (no filtering)
// 
// IMPORTANT: participant.identity is set when joining the room and NEVER changes, even when language changes.
// When language changes, new tracks are published but they still use the same identity in track names.
// So we only need to capture identity once when the room connects.
function TrackFilter({ roomMode = 'multi-language' }) {
  const room = useRoomContext();
  const [myIdentity, setMyIdentity] = useState('');

  // Get and store our identity when room connects
  // Identity is stable - it doesn't change when language preferences change
  useEffect(() => {
    if (!room) return;

    const updateIdentity = () => {
      const identity = room.localParticipant?.identity;
      if (identity) {
        setMyIdentity(identity);
        console.log('✅ TrackFilter: My identity is:', identity, '(this will not change during the session)');
      }
    };

    // Update immediately if already connected
    if (room.state === 'connected') {
      updateIdentity();
    }

    // Update when room connects or reconnects
    // Note: Identity won't change on reconnect - it's the same participant
    room.on('connected', updateIdentity);
    room.on('reconnected', updateIdentity);

    return () => {
      room.off('connected', updateIdentity);
      room.off('reconnected', updateIdentity);
    };
  }, [room]);

  // Handle track subscriptions based on room mode
  useEffect(() => {
    if (!room) return;

    console.log('🎯 TrackFilter: Setting up track handlers, roomMode:', roomMode, 'myIdentity:', myIdentity);

    const onTrackSubscribed = (track, publication, participant) => {
      // Only handle audio tracks
      if (track.kind !== 'audio') return;

      const trackName = publication.trackName || '';
      console.log('📡 Track subscribed:', trackName, 'from participant:', participant?.identity);

      // Normal microphone tracks from humans → always play (VideoConference handles these)
      if (!trackName.startsWith('translation-')) {
        return;
      }

      // This is a translation track
      console.log('🔊 Translation track subscribed:', trackName, 'roomMode:', roomMode);
      
      if (roomMode === '2-languages') {
        // In 2-languages mode: Subscribe to ALL translation tracks so everyone hears everything
        console.log('🌍 2-languages mode: Ensuring subscription to translation track:', trackName);
        if (!publication.isSubscribed) {
          publication.setSubscribed(true);
          console.log('✅ Subscribed to translation track:', trackName);
        }
        // Ensure track is attached (VideoConference should handle this, but ensure it)
        if (track.attachedElements.length === 0) {
          // Find or create audio element for this track
          const audioElement = document.createElement('audio');
          audioElement.autoplay = true;
          audioElement.playsInline = true;
          track.attach(audioElement);
          document.body.appendChild(audioElement);
          console.log('✅ Attached translation track in 2-languages mode:', trackName);
        } else {
          console.log('✅ Translation track already attached:', trackName);
        }
      } else {
        // Multi-language mode: Only subscribe to tracks meant for me
        if (!myIdentity) {
          console.warn('⚠️ Multi-language mode but identity not available yet');
          return;
        }

        const parts = trackName.split('-');
        if (parts.length < 3) {
          console.warn('Invalid translation track name format:', trackName);
          return;
        }

        const targetIdentity = parts[1]; // The participant this translation is FOR

        if (targetIdentity === myIdentity) {
          // This translation is for me → ensure it's subscribed
          console.log('✅ Allowing my translation track:', trackName, '(target:', targetIdentity, 'me:', myIdentity + ')');
          if (!publication.isSubscribed) {
            publication.setSubscribed(true);
          }
        } else {
          // This is someone else's translation → unsubscribe to save bandwidth
          console.log('🚫 Ignoring foreign translation track:', trackName, '(target:', targetIdentity, 'me:', myIdentity + ')');
          if (publication.isSubscribed) {
            publication.setSubscribed(false);
          }
          track.detach();
        }
      }
    };

    // Also handle trackPublished to ensure we subscribe when tracks are published
    const onTrackPublished = (publication, participant) => {
      if (publication.kind !== 'audio') return;
      const trackName = publication.trackName || '';
      
      console.log('📢 Track published:', trackName, 'from participant:', participant?.identity);
      
      if (trackName.startsWith('translation-')) {
        console.log('🔊 Translation track published:', trackName, 'roomMode:', roomMode);
        
        if (roomMode === '2-languages') {
          // In 2-languages mode, subscribe to all translation tracks
          console.log('🌍 2-languages mode: Subscribing to published translation track:', trackName);
          if (!publication.isSubscribed) {
            publication.setSubscribed(true);
            console.log('✅ Subscribed to published translation track:', trackName);
          } else {
            console.log('✅ Already subscribed to translation track:', trackName);
          }
        } else {
          // Multi-language mode: Only subscribe if it's for me
          if (myIdentity) {
            const parts = trackName.split('-');
            if (parts.length >= 3 && parts[1] === myIdentity) {
              console.log('✅ Subscribing to my translation track:', trackName);
              if (!publication.isSubscribed) {
                publication.setSubscribed(true);
              }
            } else {
              console.log('🚫 Not subscribing to foreign translation track:', trackName);
            }
          }
        }
      }
    };

    // Check for existing tracks when component mounts (in case tracks were published before we set up listeners)
    const checkExistingTracks = () => {
      console.log('🔍 Checking existing tracks...');
      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((publication) => {
          const trackName = publication.trackName || '';
          if (trackName.startsWith('translation-')) {
            console.log('🔊 Found existing translation track:', trackName, 'subscribed:', publication.isSubscribed);
            if (roomMode === '2-languages') {
              if (!publication.isSubscribed) {
                publication.setSubscribed(true);
                console.log('✅ Subscribed to existing translation track:', trackName);
              }
            }
          }
        });
      });
    };

    // Set up event listeners
    room.on('trackSubscribed', onTrackSubscribed);
    room.on('trackPublished', onTrackPublished);
    
    // Check existing tracks after a short delay (to ensure room is fully connected)
    setTimeout(checkExistingTracks, 1000);

    return () => {
      room.off('trackSubscribed', onTrackSubscribed);
      room.off('trackPublished', onTrackPublished);
    };
  }, [room, myIdentity, roomMode]);

  return null; // This component doesn't render anything
}

export default MeetingRoom;
