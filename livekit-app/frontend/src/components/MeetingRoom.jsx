import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { LiveKitRoom, VideoConference, formatChatMessageLinks, useRoomContext } from '@livekit/components-react';
import toast from 'react-hot-toast';
import { Loader2, Settings } from 'lucide-react';
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
    
    console.log('MeetingRoom: Resolved participantName:', participantName);
    console.log('MeetingRoom: isHost:', isHost);
    
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
        <TrackFilter 
          selectedLanguage={selectedLanguage}
          translationEnabled={translationEnabled}
        />
        <VideoConference 
          chatMessageFormatter={formatChatMessageLinks}
        />
        
        {/* Room controls for handling translation data */}
        <RoomControls 
          selectedLanguage={selectedLanguage}
          translationEnabled={translationEnabled}
          participantName={participantInfo?.participantName || ''}
          isHost={participantInfo?.isHost || false}
        />
        
        {/* Custom Control Bar at Bottom - Language Selector, VAD Controls (Host), and Share Button */}
        {/* Positioned at bottom, aligned with LiveKit's control bar */}
        <div className="lk-control-bar-custom">
          {/* Language Selector */}
          <LanguageSelector
            value={selectedLanguage}
            onChange={setSelectedLanguage}
            onTranslationToggle={() => setTranslationEnabled(!translationEnabled)}
            translationEnabled={translationEnabled}
          />
          
          {/* VAD Sensitivity Controls - Host Only */}
          {participantInfo?.isHost && <VADSensitivityControls />}
          
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

// Component to filter translation tracks based on selected language
// Always subscribes to tracks matching your selected language (unified optimized mode)
// Track format: translation-{target_language}-{source_participant}
// Example: translation-es-Kenny (Spanish translation from Kenny)
function TrackFilter({ selectedLanguage = 'en', translationEnabled = false }) {
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

  // Handle track subscriptions based on room mode AND selected language
  useEffect(() => {
    if (!room) return;

    console.log('🎯 TrackFilter: Setting up track handlers, selectedLanguage:', selectedLanguage, 'translationEnabled:', translationEnabled);

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
      console.log('🔊 Translation track subscribed:', trackName);
      
      // Unified mode: Subscribe based on selected language
      // Track format: translation-{target_language}-{source_participant}
      // Example: translation-es-Kenny → parts = ["translation", "es", "Kenny"]
      // Example: translation-en-Ii → parts = ["translation", "en", "Ii"] (English listeners need this!)
      
      if (!translationEnabled) {
        // Translation disabled → unsubscribe from all translation tracks
        console.log('🚫 Translation disabled, unsubscribing from:', trackName);
        if (publication.isSubscribed) {
          publication.setSubscribed(false);
        }
        track.detach();
        return;
      }

      const parts = trackName.split('-');
      if (parts.length < 3) {
        console.warn('Invalid translation track name format:', trackName);
        return;
      }

      const targetLanguage = parts[1]; // The target language (e.g., "es", "fr", "en")

      if (targetLanguage === selectedLanguage) {
        // This translation matches my selected language → subscribe
        // This works for English listeners too! They subscribe to translation-en-* tracks
        console.log('✅ Subscribing to my language track:', trackName, '(target:', targetLanguage, 'selected:', selectedLanguage + ')');
        if (!publication.isSubscribed) {
          publication.setSubscribed(true);
        }
      } else {
        // This is a different language → unsubscribe to save bandwidth
        console.log('🚫 Ignoring foreign language track:', trackName, '(target:', targetLanguage, 'selected:', selectedLanguage + ')');
        if (publication.isSubscribed) {
          publication.setSubscribed(false);
        }
        track.detach();
      }
    };

    // Also handle trackPublished to ensure we subscribe when tracks are published
    const onTrackPublished = (publication, participant) => {
      if (publication.kind !== 'audio') return;
      const trackName = publication.trackName || '';
      
      console.log('📢 Track published:', trackName, 'from participant:', participant?.identity);
      
      if (trackName.startsWith('translation-')) {
        console.log('🔊 Translation track published:', trackName);
        
        // Unified mode: Subscribe based on selected language
        if (!translationEnabled) {
          console.log('🚫 Translation disabled, not subscribing to:', trackName);
          return;
        }

        const parts = trackName.split('-');
        if (parts.length >= 3) {
          const targetLanguage = parts[1];
          if (targetLanguage === selectedLanguage) {
            // This works for English listeners too! They subscribe to translation-en-* tracks
            console.log('✅ Subscribing to my language track:', trackName, '(target:', targetLanguage, 'selected:', selectedLanguage + ')');
            if (!publication.isSubscribed) {
              publication.setSubscribed(true);
            }
          } else {
            console.log('🚫 Not subscribing to foreign language track:', trackName);
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
              
              // Unified mode: Update subscription based on current language selection
              if (!translationEnabled) {
                if (publication.isSubscribed) {
                  publication.setSubscribed(false);
                  console.log('🚫 Unsubscribed from translation track (disabled):', trackName);
                }
              } else {
                const parts = trackName.split('-');
                if (parts.length >= 3) {
                  const targetLanguage = parts[1];
                  if (targetLanguage === selectedLanguage) {
                    // This works for English listeners too! They subscribe to translation-en-* tracks
                    if (!publication.isSubscribed) {
                      publication.setSubscribed(true);
                      console.log('✅ Subscribed to existing translation track:', trackName, '(target:', targetLanguage, 'selected:', selectedLanguage + ')');
                    }
                  } else {
                    if (publication.isSubscribed) {
                      publication.setSubscribed(false);
                      console.log('🚫 Unsubscribed from foreign language track:', trackName);
                    }
                  }
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
  }, [room, myIdentity, selectedLanguage, translationEnabled]); // Add selectedLanguage and translationEnabled to dependencies

  return null; // This component doesn't render anything
}

// VAD Sensitivity Controls Component - Rendered in bottom control bar for host
function VADSensitivityControls() {
  const [vadSensitivity, setVadSensitivity] = useState('medium');
  const [showDropdown, setShowDropdown] = useState(false);

  const handleVadChange = (level) => {
    if (window.__roomControls?.sendVadSetting) {
      window.__roomControls.sendVadSetting(level);
      setVadSensitivity(level);
      setShowDropdown(false);
    }
  };

  // Sync with RoomControls state
  useEffect(() => {
    const interval = setInterval(() => {
      if (window.__roomControls?.vadSensitivity) {
        setVadSensitivity(window.__roomControls.vadSensitivity);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showDropdown) return;
    
    const handleClickOutside = (event) => {
      const target = event.target;
      if (!target.closest('.lk-vad-dropdown') && !target.closest('.lk-vad-button')) {
        setShowDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="lk-vad-button"
        title="Translation Sensitivity"
        aria-label="Translation Sensitivity"
        style={{
          background: 'rgba(31, 41, 55, 0.95)',
          color: 'white',
          border: 'none',
          borderRadius: '0.5rem',
          minWidth: '44px',
          minHeight: '44px',
          padding: '0.5rem 0.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        }}
        onMouseEnter={(e) => {
          e.target.style.transform = 'translateY(-1px)';
          e.target.style.boxShadow = '0 6px 8px -1px rgba(0, 0, 0, 0.15), 0 4px 6px -1px rgba(0, 0, 0, 0.1)';
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = 'translateY(0)';
          e.target.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
        }}
      >
        <Settings className="w-5 h-5 md:w-6 md:h-6" />
        <span className="hidden sm:inline lk-vad-button-text" style={{ fontSize: '0.875rem' }}>
          {vadSensitivity === 'low' ? 'Low' : vadSensitivity === 'high' ? 'High' : 'Medium'}
        </span>
      </button>

      {showDropdown && (
        <div className="lk-vad-dropdown" style={{
          position: 'absolute',
          bottom: '100%',
          right: 0,
          marginBottom: '0.5rem',
          background: 'rgba(31, 41, 55, 0.98)',
          borderRadius: '0.5rem',
          padding: '0.75rem',
          minWidth: '240px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2)',
          zIndex: 70,
          border: '1px solid rgba(75, 85, 99, 0.5)',
        }}>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.75rem', lineHeight: '1.4' }}>
            Translation Sensitivity
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button
              onClick={() => handleVadChange('low')}
              style={{
                padding: '0.75rem',
                borderRadius: '0.375rem',
                border: vadSensitivity === 'low' ? '2px solid #3b82f6' : '1px solid rgba(75, 85, 99, 0.5)',
                background: vadSensitivity === 'low' ? 'rgba(30, 58, 138, 0.8)' : 'rgba(31, 41, 55, 0.8)',
                color: 'white',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s',
                fontSize: '0.8125rem',
              }}
              onMouseEnter={(e) => {
                if (vadSensitivity !== 'low') {
                  e.target.style.background = 'rgba(55, 65, 81, 0.8)';
                }
              }}
              onMouseLeave={(e) => {
                if (vadSensitivity !== 'low') {
                  e.target.style.background = 'rgba(31, 41, 55, 0.8)';
                }
              }}
            >
              <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>Low Sensitivity</div>
              <div style={{ fontSize: '0.6875rem', color: '#9ca3af', lineHeight: '1.3' }}>
                Forgiving - ignores coughs, "umm", background noise
              </div>
            </button>
            
            <button
              onClick={() => handleVadChange('medium')}
              style={{
                padding: '0.75rem',
                borderRadius: '0.375rem',
                border: vadSensitivity === 'medium' ? '2px solid #3b82f6' : '1px solid rgba(75, 85, 99, 0.5)',
                background: vadSensitivity === 'medium' ? 'rgba(30, 58, 138, 0.8)' : 'rgba(31, 41, 55, 0.8)',
                color: 'white',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s',
                fontSize: '0.8125rem',
              }}
              onMouseEnter={(e) => {
                if (vadSensitivity !== 'medium') {
                  e.target.style.background = 'rgba(55, 65, 81, 0.8)';
                }
              }}
              onMouseLeave={(e) => {
                if (vadSensitivity !== 'medium') {
                  e.target.style.background = 'rgba(31, 41, 55, 0.8)';
                }
              }}
            >
              <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>Medium Sensitivity</div>
              <div style={{ fontSize: '0.6875rem', color: '#9ca3af', lineHeight: '1.3' }}>
                Balanced - good for most conversations (default)
              </div>
            </button>
            
            <button
              onClick={() => handleVadChange('high')}
              style={{
                padding: '0.75rem',
                borderRadius: '0.375rem',
                border: vadSensitivity === 'high' ? '2px solid #3b82f6' : '1px solid rgba(75, 85, 99, 0.5)',
                background: vadSensitivity === 'high' ? 'rgba(30, 58, 138, 0.8)' : 'rgba(31, 41, 55, 0.8)',
                color: 'white',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s',
                fontSize: '0.8125rem',
              }}
              onMouseEnter={(e) => {
                if (vadSensitivity !== 'high') {
                  e.target.style.background = 'rgba(55, 65, 81, 0.8)';
                }
              }}
              onMouseLeave={(e) => {
                if (vadSensitivity !== 'high') {
                  e.target.style.background = 'rgba(31, 41, 55, 0.8)';
                }
              }}
            >
              <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>High Sensitivity</div>
              <div style={{ fontSize: '0.6875rem', color: '#9ca3af', lineHeight: '1.3' }}>
                Very responsive - fast interruptions, good for debates
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MeetingRoom;
