import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { LiveKitRoom, VideoConference, formatChatMessageLinks, useRoomContext, GridLayout, FocusLayout, ParticipantTile, useTracks, useParticipants, useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';
import toast from 'react-hot-toast';
import { Loader2, Settings } from 'lucide-react';
import { authService, roomService } from '../services/api';
import ShareModal from './ShareModal';
import LanguageSelector from './LanguageSelector';
import TranscriptionDisplay from './TranscriptionDisplay';
import RoomControls from './RoomControls';
import CustomControlBar from './CustomControlBar';
import { useTranslation } from '../hooks/useTranslation';
// Autopilot Translator SDK
import { AutopilotTranslator } from '../lib/autopilot-translator';
// Will use public folder path - no import needed

function MeetingRoom() {
  const { roomName } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  
  const [token, setToken] = useState(null);
  const [livekitUrl, setLivekitUrl] = useState(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [error, setError] = useState(null);
  const [participantInfo, setParticipantInfo] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const translatorRef = useRef(null);
  const initTimeoutRef = useRef(null); // Track pending translator initialization
  const selectedLanguageRef = useRef('en'); // Track current language for timeout checks
  const isRestoringToEnglishRef = useRef(false); // Track if we're currently restoring to English
  
  // Update selected language when participant info changes
  useEffect(() => {
    if (participantInfo?.selectedLanguage) {
      setSelectedLanguage(participantInfo.selectedLanguage);
      selectedLanguageRef.current = participantInfo.selectedLanguage; // Update ref
    }
  }, [participantInfo]);
  
  // Keep ref in sync with state
  useEffect(() => {
    selectedLanguageRef.current = selectedLanguage;
  }, [selectedLanguage]);
  
  // Initialize Autopilot Translator SDK
  useEffect(() => {
    if (!isInitialized) {
      console.log('⏳ Translator init: Waiting for isInitialized...');
      return;
    }
    if (!selectedLanguage) {
      console.log('⏳ Translator init: Waiting for selectedLanguage...');
      return; // Wait for language to be set
    }
    
    console.log('🌐 Translator init effect: selectedLanguage =', selectedLanguage, 'isInitialized =', isInitialized);
    
    // CRITICAL: If we're restoring to English, don't do anything
    // This prevents creating a translator when switching to English
    if (isRestoringToEnglishRef.current && selectedLanguage === 'en') {
      console.log('🚩 Effect blocked: Currently restoring to English');
      return;
    }
    
    // Get API endpoint (same logic as api.js)
    const isNgrok = window.location.hostname.includes('ngrok.app') || 
                     window.location.hostname.includes('ngrok-free.app') ||
                     window.location.hostname.includes('ngrok.io');
    const isNetworkAccess = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const isHTTPS = window.location.protocol === 'https:';
    
    let API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
    
    if (isNgrok) {
      API_BASE_URL = '/api';
    } else if (isNetworkAccess && isHTTPS) {
      API_BASE_URL = '/api';
    } else if (isNetworkAccess) {
      API_BASE_URL = `http://${window.location.hostname}:3001/api`;
    } else {
      API_BASE_URL = '/api';
    }
    
    // Handle language changes
    if (translatorRef.current) {
      // Translator already exists - use setLanguage to change language
      if (selectedLanguage === 'en') {
        // Switching to English - restore original text first, then destroy
        const currentTranslator = translatorRef.current;
        
        // Set flag to prevent new translator creation during restoration
        isRestoringToEnglishRef.current = true;
        console.log('🚩 Flag set: isRestoringToEnglishRef = true');
        
        console.log('🔄 Switching to English - restoring original text...');
        console.log(`📊 Current language before switch: ${currentTranslator.currentLanguageValue || 'unknown'}`);
        
        // CRITICAL: Restore synchronously, then destroy immediately
        // setLanguage('en') calls restoreOriginalText() synchronously and returns immediately
        currentTranslator.setLanguage('en').then(() => {
          console.log('✅ setLanguage("en") promise resolved');
          
          // Verify restoration worked by checking a few elements
          const elementsWithOriginal = document.querySelectorAll('[data-original-text]');
          console.log(`📊 After restoration: ${elementsWithOriginal.length} elements still have data-original-text`);
          
          // Sample check - see if text was restored
          if (elementsWithOriginal.length > 0) {
            const sampleElement = elementsWithOriginal[0];
            const originalText = sampleElement.getAttribute('data-original-text');
            const currentText = sampleElement.textContent?.trim();
            console.log(`📊 Sample element - Original: "${originalText?.substring(0, 30)}..." Current: "${currentText?.substring(0, 30)}..."`);
          }
          
          // Clear flag after a short delay to allow React to finish updates
          setTimeout(() => {
            isRestoringToEnglishRef.current = false;
            console.log('✅ Restoration flag cleared');
          }, 500);
        }).catch(err => {
          console.error('❌ Error in setLanguage("en"):', err);
          isRestoringToEnglishRef.current = false;
        });
        
        // Destroy translator immediately after calling setLanguage
        // setLanguage('en') already stopped the observer and restored text synchronously
        console.log('🧹 Destroying translator instance...');
        currentTranslator.destroy();
        translatorRef.current = null;
        localStorage.removeItem('app_language');
        console.log('🌐 English selected - translator destroyed, restoration should be complete');
        
        // CRITICAL: Keep flag set longer to prevent any new translator creation
        // The flag will be cleared in the promise callback after 500ms
        
        return; // Don't create new translator
      } else {
        // Switching to a different language - use setLanguage
        translatorRef.current.setLanguage(selectedLanguage).then(() => {
          console.log(`🌐 Language changed to: ${selectedLanguage}`);
        }).catch(err => {
          console.error('Error changing language:', err);
        });
      }
      return; // Don't create new translator, we're using existing one
    }
    
    // No translator exists yet - create one ONLY if language is not English
    // CRITICAL: Double-check selectedLanguage to prevent race conditions
    // Also check if we're currently restoring to English
    if (selectedLanguage && selectedLanguage !== 'en' && !isRestoringToEnglishRef.current) {
      // Cancel any pending initialization
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
      }
      
      // CRITICAL: Wait a moment for React to finish rendering English content
      // This ensures the page is fully rendered in English before we translate
      // The translator's ensureEnglishState() will handle restoring English if needed
      const currentLanguage = selectedLanguage;
      
      initTimeoutRef.current = setTimeout(() => {
        // CRITICAL: Check if timeout was cancelled (initTimeoutRef.current would be null)
        if (!initTimeoutRef.current) {
          console.log('⚠️ Initialization timeout was cancelled');
          return;
        }
        
        // CRITICAL: Check if we're restoring to English (prevent creating translator)
        if (isRestoringToEnglishRef.current) {
          console.log('🚩 Currently restoring to English, skipping translator initialization');
          initTimeoutRef.current = null;
          return;
        }
        
        // Double-check that we still need a translator (language might have changed)
        // Check both translatorRef and current selectedLanguage state using ref
        if (translatorRef.current) {
          console.log('⚠️ Translator already exists, skipping initialization');
          initTimeoutRef.current = null;
          return;
        }
        
        // CRITICAL: Check the CURRENT language from ref (not captured value)
        // This ensures we don't create a translator if language changed to English
        const currentLang = selectedLanguageRef.current;
        if (currentLang === 'en') {
          console.log('⚠️ Language changed to English during delay, skipping initialization');
          initTimeoutRef.current = null;
          return;
        }
        
        // Verify translatorRef is still null (double-check for race conditions)
        if (translatorRef.current) {
          console.log('⚠️ Translator was created by another effect, skipping');
          initTimeoutRef.current = null;
          return;
        }
        
        // FINAL CHECK: Make absolutely sure we're not restoring to English
        if (isRestoringToEnglishRef.current) {
          console.log('🚩 FINAL CHECK: Flag is still set, aborting translator creation');
          initTimeoutRef.current = null;
          return;
        }
        
        // Initialize translator with current language from ref
        const translator = new AutopilotTranslator({
          apiEndpoint: API_BASE_URL,
          language: currentLang, // Use current language from ref
          enabledPages: [] // Empty array = all pages enabled
        });
        
        translatorRef.current = translator;
        
        // Initialize with selected language
        // This will store original text first, then translate
        translator.init(currentLang, []);
        
        console.log(`🌐 Translator initialized for language: ${currentLang}`);
        initTimeoutRef.current = null;
      }, 100); // Small delay to ensure DOM is ready
    } else if (selectedLanguage === 'en') {
      // Language is English - cancel any pending initialization and set flag
      isRestoringToEnglishRef.current = true; // Set flag to prevent any new translators
      
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
        console.log('🛑 Cancelled pending translator initialization (English selected)');
      }
      
      // Clear flag after a delay to allow React to finish updates
      setTimeout(() => {
        isRestoringToEnglishRef.current = false;
        console.log('✅ English flag cleared (no translator should be created)');
      }, 1000); // Longer delay to ensure all effects have run
      // Language is English - ensure no translator exists
      // This handles the case where useEffect runs multiple times
      if (translatorRef.current) {
        // Shouldn't happen, but clean up just in case
        translatorRef.current.destroy();
        translatorRef.current = null;
      }
      localStorage.removeItem('app_language');
      console.log('🌐 English selected - translation disabled (no translator created)');
    }
    
    // Cleanup on unmount or when dependencies change
    return () => {
      // Cancel any pending initialization
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
        console.log('🧹 Cleanup: Cancelled pending translator initialization');
      }
      
      // Only destroy translator if language changed to English or component unmounting
      // Don't destroy if just switching between non-English languages
      if (translatorRef.current && selectedLanguage === 'en') {
        console.log('🧹 Cleanup: Destroying translator (English selected)');
        translatorRef.current.destroy();
        translatorRef.current = null;
      }
    };
  }, [isInitialized, selectedLanguage]);
  
  // Update translator when language changes (handled in initialization useEffect above)
  // This effect is no longer needed as initialization handles language changes

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
      if (sessionData) {
        sessionInfo = JSON.parse(sessionData);
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
    const selectedLanguage = stateInfo.selectedLanguage || sessionInfo.selectedLanguage || 'en';
    
    if (!participantName) {
      // No name provided, redirect to join page
      navigate(`/join/${roomName}`, { replace: true });
      return;
    }
    
    // Set participant info
    setParticipantInfo({
      participantName,
      isHost,
      hostCode,
      shareableLink,
      shareableLinkNetwork,
      selectedLanguage
    });
    
    // CRITICAL: Set selectedLanguage state IMMEDIATELY before setIsInitialized
    // This ensures the translator initializes with the correct language
    console.log('MeetingRoom: Setting selectedLanguage state to:', selectedLanguage);
    setSelectedLanguage(selectedLanguage);
    selectedLanguageRef.current = selectedLanguage; // Also update ref immediately
    
    setIsInitialized(true);
    
  }, [roomName, navigate]); // Removed location.state from deps to prevent re-runs

  // Handle orientation changes to prevent layout jitter
  useEffect(() => {
    let resizeTimer;
    const handleOrientationChange = () => {
      // Debounce resize events to prevent excessive recalculations
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Force a layout recalculation after orientation change
        window.dispatchEvent(new Event('resize'));
      }, 100);
    };

    // Listen for orientation changes (works on mobile)
    window.addEventListener('orientationchange', handleOrientationChange);
    // Also listen for resize as fallback
    window.addEventListener('resize', handleOrientationChange);

    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('resize', handleOrientationChange);
    };
  }, []);

  // Connect to room once initialized
  useEffect(() => {
    if (!isInitialized || !participantInfo) {
      return;
    }
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
    <div className="h-[100dvh] bg-gray-900 relative overflow-hidden w-full">
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={livekitUrl || import.meta.env.VITE_LIVEKIT_URL || 'wss://production-uiycx4ku.livekit.cloud'}
        onDisconnected={handleDisconnected}
        options={{
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: {
            videoSimulcastLayers: [],
            videoCodec: 'vp8',
          },
        }}
        data-lk-theme="default"
        className="h-full flex flex-col"
      >
        <AutoMuteOnTranslation />
        <TrackFilter 
          selectedLanguage={selectedLanguage}
          translationEnabled={translationEnabled}
        />
        
        {/* Video Grid Container - let LiveKit handle sizing */}
        <div className="flex-1 min-h-0">
          <VideoLayoutComponent />
        </div>
        
        {/* Room controls for handling translation data */}
        <RoomControls 
          selectedLanguage={selectedLanguage}
          translationEnabled={translationEnabled}
          participantName={participantInfo?.participantName || ''}
          isHost={participantInfo?.isHost || false}
        />
        
        {/* Custom Control Bar - Below video grid */}
        <CustomControlBar
          selectedLanguage={selectedLanguage}
          setSelectedLanguage={setSelectedLanguage}
          translationEnabled={translationEnabled}
          setTranslationEnabled={setTranslationEnabled}
          isHost={participantInfo?.isHost || false}
          onShareClick={() => setShowShareModal(true)}
          onDisconnect={handleDisconnected}
        />
        
        {/* Transcription Display */}
        {translationEnabled && (
          <TranscriptionDisplay
            participantId={participantInfo?.participantName || ''}
            isVisible={true}
          />
        )}
        
        {/* Agent Tile Customization */}
        <AgentTileCustomizer />
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

// VideoLayout component - using VideoConference which handles layout switching internally
// Keep it simple - let LiveKit handle all layout logic
function VideoLayoutComponent() {
  return (
    <VideoConference 
      chatMessageFormatter={formatChatMessageLinks}
    />
  );
}

// Component to customize agent tiles: change name to "Translator" and add visual indicators
function AgentTileCustomizer() {
  const room = useRoomContext();
  const participants = useParticipants();
  const { isTranslationActive } = useTranslation(); // Get translation activity state
  // Track audio activity timestamps per participant
  const audioActivityRef = useRef(new Map());
  // Track active speakers from LiveKit
  const [activeSpeakers, setActiveSpeakers] = useState(new Set());

  useEffect(() => {
    if (!room) return;

    const updateAgentTiles = () => {
      // Find all participant tiles
      const tiles = document.querySelectorAll('.lk-participant-tile, [class*="ParticipantTile"]');
      
      // First, identify all agent participants by their identity (always starts with "agent-")
      // Also check for translation-bot in identity for compatibility with different agent names
      const agentParticipants = participants.filter(p => {
        const identity = p.identity || '';
        return identity.startsWith('agent-') || 
               identity.includes('translation-bot') ||
               p.metadata?.role === 'agent';
      });
      
      // Create a map of agent identities for quick lookup
      const agentIdentities = new Set(agentParticipants.map(p => p.identity));
      
      // Process each tile
      tiles.forEach(tile => {
        // CRITICAL: Mark entire tile as non-translatable FIRST to prevent any translation
        tile.setAttribute('data-no-translate', 'true');
        
        // Try to find participant identity from tile
        const nameElement = tile.querySelector('[class*="name"], .lk-participant-name, [data-participant-name], [class*="ParticipantName"]');
        if (!nameElement) return;
        
        // CRITICAL: Mark all participant names as non-translatable IMMEDIATELY
        // This prevents the DOM translator from translating user names and "Translator" text
        // Set attribute BEFORE any text changes to prevent race conditions
        nameElement.setAttribute('data-no-translate', 'true');
        
        // Also mark parent elements to ensure exclusion
        let parent = nameElement.parentElement;
        let depth = 0;
        while (parent && parent !== tile && depth < 3) {
          parent.setAttribute('data-no-translate', 'true');
          parent = parent.parentElement;
          depth++;
        }

        // Get the ORIGINAL name (before our modifications)
        // CRITICAL: Check data-original-name first, then current text
        let originalName = nameElement.getAttribute('data-original-name');
        const currentDisplayName = nameElement.textContent?.trim() || '';
        
        // If we don't have a stored original name, use current display as original
        // BUT: If current display is "Translator", we need to skip this tile or restore it
        if (!originalName) {
          if (currentDisplayName === 'Translator') {
            // This tile was already changed but lost its original name - skip it
            // We can't safely restore it without knowing what it was
            return;
          }
          originalName = currentDisplayName;
        }
        
        // Try to find which participant this tile belongs to
        // Match by checking the ORIGINAL name - EXACT MATCHES ONLY
        let matchingParticipant = null;
        
        for (const participant of participants) {
          const identity = participant.identity || '';
          const name = participant.name || '';
          
          // STRICT MATCHING: Only exact matches - no partial matches!
          if (originalName === identity || originalName === name) {
            matchingParticipant = participant;
            break;
          }
        }
        
        // If we couldn't match, skip this tile to avoid false positives
        if (!matchingParticipant) {
          // If tile is already marked as agent but we can't match it, restore it
          if (tile.getAttribute('data-is-agent') === 'true' && currentDisplayName === 'Translator') {
            if (nameElement.hasAttribute('data-original-name')) {
              const restoreName = nameElement.getAttribute('data-original-name');
              console.log(`🔄 AgentTileCustomizer: Restoring tile name from "Translator" to "${restoreName}" (could not match)`);
              nameElement.textContent = restoreName;
              nameElement.setAttribute('data-no-translate', 'true'); // Prevent translation
              nameElement.removeAttribute('data-original-name');
              tile.setAttribute('data-is-agent', 'false');
            }
          }
          return;
        }
        
        // Check if this participant is an agent (identity starts with "agent-")
        const isAgent = agentIdentities.has(matchingParticipant.identity);
        
        // CRITICAL: If tile shows "Translator" but participant is NOT an agent, restore immediately!
        if (currentDisplayName === 'Translator' && !isAgent) {
          console.log(`⚠️ AgentTileCustomizer: Tile shows "Translator" but participant "${matchingParticipant.identity}" is NOT an agent. Restoring...`);
          if (nameElement.hasAttribute('data-original-name')) {
            const restoreName = nameElement.getAttribute('data-original-name');
            nameElement.textContent = restoreName;
            nameElement.setAttribute('data-no-translate', 'true'); // Prevent translation
            nameElement.removeAttribute('data-original-name');
            tile.setAttribute('data-is-agent', 'false');
          } else {
            // Fallback: restore to participant name or identity
            nameElement.textContent = matchingParticipant.name || matchingParticipant.identity || originalName;
            nameElement.setAttribute('data-no-translate', 'true'); // Prevent translation
            tile.setAttribute('data-is-agent', 'false');
          }
          return;
        }
        
        if (isAgent) {
          // This is an AGENT tile
          tile.setAttribute('data-is-agent', 'true');
          tile.setAttribute('data-participant-identity', matchingParticipant.identity);
          
          // Update display name to "Translator" if not already set
          if (!nameElement.hasAttribute('data-original-name')) {
            const originalText = originalName || matchingParticipant.identity || '';
            if (originalText && originalText !== 'Translator') {
              nameElement.setAttribute('data-original-name', originalText);
              nameElement.setAttribute('data-no-translate', 'true'); // Prevent translation of "Translator"
              nameElement.textContent = 'Translator';
            }
          } else if (nameElement.textContent !== 'Translator') {
            // Ensure it says "Translator" and prevent translation
            nameElement.setAttribute('data-no-translate', 'true');
            nameElement.textContent = 'Translator';
          } else {
            // Already says "Translator" - ensure it's marked as non-translatable
            nameElement.setAttribute('data-no-translate', 'true');
          }

          // Check if agent has video track - set data attribute for avatar display
          // Agents typically don't publish video, so check participant's video track publications
          const videoPublications = Array.from(matchingParticipant.videoTrackPublications.values());
          const hasVideoTrack = videoPublications.some(pub => pub.track !== null && pub.track !== undefined);
          
          // Also check DOM for video element as fallback
          const videoElement = tile.querySelector('video');
          const hasVideoInDOM = videoElement && 
                               videoElement.style.display !== 'none' && 
                               videoElement.readyState >= 2;
          
          const hasVideo = hasVideoTrack || hasVideoInDOM;
          
          // Debug logging removed for cleaner console
          
          if (hasVideo) {
            tile.removeAttribute('data-no-video');
            // Remove avatar if video is present
            const avatarImg = tile.querySelector('.translator-owl-avatar');
            if (avatarImg) avatarImg.remove();
          } else {
            tile.setAttribute('data-no-video', 'true');
            
            // Hide LiveKit's default placeholder (usually an SVG or icon)
            const defaultPlaceholder = tile.querySelector('svg, [class*="placeholder"], [class*="avatar"], .lk-participant-placeholder');
            if (defaultPlaceholder) {
              defaultPlaceholder.style.display = 'none';
            }
            
            // Also hide any default background patterns
            const tileContent = tile.querySelector('[class*="content"], [class*="video"], .lk-participant-video');
            if (tileContent && !tileContent.querySelector('video')) {
              tileContent.style.backgroundImage = 'none';
            }
            
            // Add avatar img element if not already present
            let avatarImg = tile.querySelector('.translator-owl-avatar');
            if (!avatarImg) {
              avatarImg = document.createElement('img');
              avatarImg.className = 'translator-owl-avatar';
              // Use public folder path - Vite serves files from public at root
              // Use a timestamp to bust cache if needed
              avatarImg.src = `/translator-owl.jpg?t=${Date.now()}`;
              avatarImg.alt = 'Translator';
              avatarImg.loading = 'eager'; // Load immediately
              avatarImg.crossOrigin = 'anonymous'; // Handle CORS if needed
              
              // Set inline styles with !important equivalent - responsive sizing
              // Use viewport-based units for better scaling across screen sizes
              const tileRect = tile.getBoundingClientRect();
              const tileSize = Math.min(tileRect.width, tileRect.height);
              // Make owl 40% of the smaller tile dimension, but with min/max constraints
              const owlSize = Math.max(160, Math.min(300, tileSize * 0.4));
              
              avatarImg.setAttribute('style', `position: absolute !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important; width: ${owlSize}px !important; height: ${owlSize}px !important; max-width: 50% !important; max-height: 50% !important; object-fit: contain !important; opacity: 0.9 !important; z-index: 1000 !important; pointer-events: none !important; display: block !important; visibility: visible !important;`);
              
              // Add event handlers for debugging
              avatarImg.onload = () => {
                // Owl avatar image loaded successfully
                avatarImg.style.opacity = '0.9';
              };
              avatarImg.onerror = (e) => {
                console.error('🦉 Failed to load owl image from:', avatarImg.src);
                console.error('🦉 Error details:', e);
                // Try fallback path
                const fallbackPath = '/translator-owl.jpg';
                if (avatarImg.src !== `${window.location.origin}${fallbackPath}`) {
                  // Trying fallback image path
                  avatarImg.src = fallbackPath;
                } else {
                  console.error('🦉 All image paths failed. Check Network tab for details.');
                }
              };
              
              // Append directly to tile (most reliable)
              tile.style.position = 'relative';
              
              // Use requestAnimationFrame to ensure DOM is ready
              requestAnimationFrame(() => {
                tile.appendChild(avatarImg);
                // Owl avatar added to agent tile
                
                // Force a reflow to ensure rendering
                void avatarImg.offsetHeight;
              });
            } else {
              // Ensure existing avatar is visible
              avatarImg.style.display = 'block';
              avatarImg.style.visibility = 'visible';
              avatarImg.style.opacity = '0.9';
            }
          }

          // Use LiveKit's built-in speaking detection - much simpler and more reliable!
          // Method 1: Check participant's isSpeaking property (most reliable)
          const isSpeaking = matchingParticipant.isSpeaking || false;
          
          // Method 2: Check if participant is in active speakers list
          const isActiveSpeaker = activeSpeakers.has(matchingParticipant.identity);
          
          // Method 3: Check if tile has LiveKit's speaking CSS class (blue outline)
          // LiveKit typically adds 'lk-speaking' class or similar when speaking
          const tileHasSpeakingClass = 
            tile.classList.contains('lk-speaking') || 
            tile.classList.contains('speaking') ||
            tile.hasAttribute('data-speaking');
          
          // Check if currently speaking (audio-based detection)
          const currentlySpeaking = isSpeaking || isActiveSpeaker || tileHasSpeakingClass;
          
          // CRITICAL: Also check translation activity state - show indicator for ALL users when translation is active
          // This ensures everyone sees the visual indicator, even if they're not subscribed to the translation audio track
          const translationIsActive = isTranslationActive();
          
          // Track speaking state with timestamp for smooth transitions
          const participantId = matchingParticipant.identity;
          const lastSpeakingKey = `${participantId}-lastSpeaking`;
          
          // Initialize hasActiveAudio
          let hasActiveAudio = false;
          
          // Show indicator if translation is active OR if agent is currently speaking
          if (translationIsActive || currentlySpeaking) {
            // Translation is active or agent is speaking - update timestamp and show indicator
            audioActivityRef.current.set(lastSpeakingKey, Date.now());
            hasActiveAudio = true;
          } else {
            // Not speaking and translation not active - check if we should keep showing (grace period)
            const lastSpeakingTime = audioActivityRef.current.get(lastSpeakingKey);
            if (lastSpeakingTime) {
              const timeSinceLastSpeaking = Date.now() - lastSpeakingTime;
              // Keep showing for 500ms after speaking stops (smooth transition, handles pauses)
              if (timeSinceLastSpeaking < 500) {
                hasActiveAudio = true;
              } else {
                // Been silent for too long - clear timestamp
                audioActivityRef.current.delete(lastSpeakingKey);
              }
            }
          }

          if (hasActiveAudio) {
            tile.setAttribute('data-audio-active', 'true');
            
            // Add soundwave bars if not already present
            if (!tile.querySelector('.soundwave-indicator')) {
              const soundwave = document.createElement('div');
              soundwave.className = 'soundwave-indicator';
              for (let i = 0; i < 5; i++) {
                const bar = document.createElement('div');
                bar.className = 'soundwave-bar';
                soundwave.appendChild(bar);
              }
              tile.appendChild(soundwave);
            }
          } else {
            tile.removeAttribute('data-audio-active');
            const soundwave = tile.querySelector('.soundwave-indicator');
            if (soundwave) soundwave.remove();
          }
        } else {
          // This is NOT an agent tile (regular user tile)
          tile.setAttribute('data-is-agent', 'false');
          
          // Restore original name if it was changed
          if (nameElement.hasAttribute('data-original-name')) {
            const originalNameToRestore = nameElement.getAttribute('data-original-name');
            nameElement.textContent = originalNameToRestore;
            nameElement.removeAttribute('data-original-name');
          }
          
          // Ensure user names are not translated
          nameElement.setAttribute('data-no-translate', 'true');
          
          // Remove any soundwave indicators
          const soundwave = tile.querySelector('.soundwave-indicator');
          if (soundwave) soundwave.remove();
          tile.removeAttribute('data-audio-active');
        }
      });
    };

    // Run immediately
    updateAgentTiles();

    // Update on track events
    const handleTrackSubscribed = () => {
      setTimeout(updateAgentTiles, 100);
    };

    const handleTrackPublished = () => {
      setTimeout(updateAgentTiles, 100);
    };

    const handleParticipantConnected = () => {
      setTimeout(updateAgentTiles, 200);
    };

    // Listen to participant speaking changes - LiveKit's built-in detection
    const handleParticipantSpeakingChanged = () => {
      // Trigger tile update when speaking status changes
      setTimeout(updateAgentTiles, 50);
    };

    room.on('trackSubscribed', handleTrackSubscribed);
    room.on('trackPublished', handleTrackPublished);
    room.on('participantConnected', handleParticipantConnected);
    room.on('participantDisconnected', handleParticipantConnected);
    room.on('activeSpeakersChanged', handleParticipantSpeakingChanged);
    room.on('trackUnsubscribed', handleTrackSubscribed);

    // Also listen to individual participant speaking events
    participants.forEach(participant => {
      if (participant.identity?.startsWith('agent-')) {
        participant.on('isSpeakingChanged', handleParticipantSpeakingChanged);
      }
    });

    // Check periodically to catch CSS class changes (LiveKit's blue outline)
    const interval = setInterval(updateAgentTiles, 200);

    return () => {
      room.off('trackSubscribed', handleTrackSubscribed);
      room.off('trackPublished', handleTrackPublished);
      room.off('participantConnected', handleParticipantConnected);
      room.off('participantDisconnected', handleParticipantConnected);
      room.off('activeSpeakersChanged', handleParticipantSpeakingChanged);
      room.off('trackUnsubscribed', handleTrackSubscribed);
      
      // Remove participant speaking listeners
      participants.forEach(participant => {
        if (participant.identity?.startsWith('agent-')) {
          participant.off('isSpeakingChanged', handleParticipantSpeakingChanged);
        }
      });
      
      clearInterval(interval);
    };
  }, [room, participants, isTranslationActive]); // Re-run when translation activity changes

  return null;
}

// Component to automatically mute microphone when translation audio is playing
// Uses the same detection logic as the audio wave bar (isTranslationActive)
function AutoMuteOnTranslation() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { isTranslationActive } = useTranslation();
  const autoMutedRef = useRef(false); // Track if WE auto-muted (so we can unmute later)
  const wasEnabledBeforeAutoMuteRef = useRef(true); // Track mic state before auto-mute

  useEffect(() => {
    if (!room || !localParticipant) return;

    const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!micPub) return;

    // Use the same detection logic as audio wave bar - check if translation is active
    const translationIsActive = isTranslationActive();

    if (translationIsActive) {
      // Translation is active - mute microphone if not already muted
      if (!micPub.isMuted) {
        // Save current state before muting
        wasEnabledBeforeAutoMuteRef.current = true;
        autoMutedRef.current = true;
        localParticipant.setMicrophoneEnabled(false).catch(err => {
          console.error('Error muting microphone during translation:', err);
          autoMutedRef.current = false; // Reset on error
        });
      }
    } else {
      // Translation is not active - unmute if WE auto-muted it (not if user manually muted)
      if (micPub.isMuted && autoMutedRef.current && wasEnabledBeforeAutoMuteRef.current) {
        // We auto-muted it and it was enabled before, so restore it
        localParticipant.setMicrophoneEnabled(true).catch(err => {
          console.error('Error unmuting microphone after translation:', err);
        });
        autoMutedRef.current = false; // Reset flag
      }
    }
  }, [room, localParticipant, isTranslationActive]);

  // Track if user manually mutes/unmutes (so we don't override their choice)
  useEffect(() => {
    if (!localParticipant) return;

    const handleMicMuted = () => {
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
      if (micPub?.isMuted && !autoMutedRef.current) {
        // User manually muted - don't auto-unmute
        wasEnabledBeforeAutoMuteRef.current = false;
      } else if (!micPub?.isMuted && !autoMutedRef.current) {
        // User manually unmuted - update our tracking
        wasEnabledBeforeAutoMuteRef.current = true;
      }
    };

    localParticipant.on('trackMuted', handleMicMuted);
    localParticipant.on('trackUnmuted', handleMicMuted);

    return () => {
      if (localParticipant) {
        localParticipant.off('trackMuted', handleMicMuted);
        localParticipant.off('trackUnmuted', handleMicMuted);
      }
    };
  }, [localParticipant]);

  return null;
}

// Component to filter translation tracks based on selected language
// Always subscribes to tracks matching your selected language (unified optimized mode)
// Track format: translation-{target_language}
// Example: translation-es (Spanish translation)
// UNIFIED MODE: When only 2 languages are active, subscribes to translation-unified tracks
function TrackFilter({ selectedLanguage = 'en', translationEnabled = false }) {
  const room = useRoomContext();
  const [myIdentity, setMyIdentity] = useState('');
  const [roomMode, setRoomMode] = useState('normal'); // 'normal' or 'unified'
  const [unifiedLanguages, setUnifiedLanguages] = useState([]);

  // Get and store our identity when room connects
  // Identity is stable - it doesn't change when language preferences change
  useEffect(() => {
    if (!room) return;

    const updateIdentity = () => {
      const identity = room.localParticipant?.identity;
      if (identity) {
        setMyIdentity(identity);
        // TrackFilter: Identity set (will not change during session)
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

  // Listen for room mode broadcasts from agent
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload, participant) => {
      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));
        
        if (message.type === 'room_mode') {
          console.log('📢 Room mode update received:', message);
          setRoomMode(message.mode || 'normal');
          setUnifiedLanguages(message.languages || []);
        }
      } catch (error) {
        // Not a room mode message, ignore
      }
    };

    room.on('dataReceived', handleDataReceived);
    return () => {
      room.off('dataReceived', handleDataReceived);
    };
  }, [room]);

  // Handle track subscriptions based on room mode AND selected language
  useEffect(() => {
    if (!room) return;

    // TrackFilter: Setting up track handlers

    // Track which translation track we're subscribed to for each target language
    // This ensures we only subscribe to ONE track per target language
    const subscribedTracksByLanguage = new Map(); // Map<targetLanguage, trackName>

    // Helper function to extract language code from track name
    // Format: translation-{language_code}-{speaker_id}
    // Examples: translation-es-CO-speaker123 → "es-CO", translation-es-speaker123 → "es"
    const extractLanguageFromTrackName = (trackName) => {
      if (!trackName.startsWith('translation-')) {
        return null;
      }
      // Remove "translation-" prefix
      const withoutPrefix = trackName.substring('translation-'.length);
      // Find the last hyphen (separates language_code from speaker_id)
      const lastHyphenIndex = withoutPrefix.lastIndexOf('-');
      if (lastHyphenIndex === -1) {
        // No speaker_id part, just language (old format)
        return withoutPrefix;
      }
      // Extract language code (everything before the last hyphen)
      return withoutPrefix.substring(0, lastHyphenIndex);
    };

    const unsubscribeFromOtherTracksForLanguage = (targetLanguage, currentTrackName) => {
      // Find and unsubscribe from any other tracks for this target language
      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((publication) => {
          const trackName = publication.trackName || '';
          if (trackName.startsWith('translation-') && 
              !trackName.startsWith('translation-unified')) {
            const trackLanguage = extractLanguageFromTrackName(trackName);
            if (trackLanguage === targetLanguage && trackName !== currentTrackName) {
              if (publication.isSubscribed) {
                // Unsubscribing from other track for same language
                publication.setSubscribed(false);
                if (publication.track) {
                  publication.track.detach();
                }
              }
            }
          }
        });
      });
    };

    const onTrackSubscribed = (track, publication, participant) => {
      // Only handle audio tracks
      if (track.kind !== 'audio') return;

      const trackName = publication.trackName || '';
      // Track subscribed

      // Normal microphone tracks from humans → always play (VideoConference handles these)
      if (!trackName.startsWith('translation-')) {
        return;
      }

      // This is a translation track
        // Translation track subscribed
      
      // Check if this is unified mode or normal mode
      if (!translationEnabled) {
        // Translation disabled → unsubscribe from all translation tracks
        // Translation disabled, unsubscribing
        if (publication.isSubscribed) {
          publication.setSubscribed(false);
        }
        track.detach();
        return;
      }

      // UNIFIED MODE: Subscribe to unified tracks
      if (roomMode === 'unified' && trackName.startsWith('translation-unified')) {
        // UNIFIED MODE: Subscribing to unified track
        if (!publication.isSubscribed) {
          publication.setSubscribed(true);
        }
        return;
      }

      // NORMAL MODE: Subscribe based on selected language
      // Track format: translation-{target_language}-{speaker_id}
      // Example: translation-es-CO-speaker123 → language = "es-CO"
      // Example: translation-es-speaker123 → language = "es"
      
      // Skip unified tracks in normal mode
      if (trackName.startsWith('translation-unified')) {
        // Normal mode: Skipping unified track
        if (publication.isSubscribed) {
          publication.setSubscribed(false);
        }
        track.detach();
        return;
      }

      const targetLanguage = extractLanguageFromTrackName(trackName);
      if (!targetLanguage) {
        console.warn('Invalid translation track name format:', trackName);
        return;
      }

      if (targetLanguage === selectedLanguage) {
        // This translation matches my selected language → subscribe
        // IMPORTANT: Only subscribe to ONE track per target language to avoid multiple audio streams
        const currentSubscribedTrack = subscribedTracksByLanguage.get(targetLanguage);
        
        if (currentSubscribedTrack && currentSubscribedTrack !== trackName) {
          // We already have a track subscribed for this language → unsubscribe from the old one
          // Already subscribed to track, unsubscribing before subscribing to new one
          unsubscribeFromOtherTracksForLanguage(targetLanguage, trackName);
        }
        
        // Subscribe to this track
        // Subscribing to language track
        if (!publication.isSubscribed) {
          publication.setSubscribed(true);
        }
        subscribedTracksByLanguage.set(targetLanguage, trackName);
      } else {
        // This is a different language → unsubscribe to save bandwidth
        // Ignoring foreign language track
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
      
      // Track published
      
      if (trackName.startsWith('translation-')) {
        // Translation track published
        
        // Check mode and subscribe accordingly
        if (!translationEnabled) {
          // Translation disabled, not subscribing
          return;
        }

        // UNIFIED MODE: Subscribe to unified tracks
        if (roomMode === 'unified' && trackName.startsWith('translation-unified')) {
          // UNIFIED MODE: Subscribing to unified track
          if (!publication.isSubscribed) {
            publication.setSubscribed(true);
          }
          return;
        }

        // NORMAL MODE: Subscribe based on selected language
        // Track format: translation-{target_language}-{speaker_id}
        // Skip unified tracks in normal mode
        if (trackName.startsWith('translation-unified')) {
          // Normal mode: Skipping unified track
          return;
        }

        const targetLanguage = extractLanguageFromTrackName(trackName);
        if (targetLanguage) {
          if (targetLanguage === selectedLanguage) {
            // IMPORTANT: Only subscribe to ONE track per target language
            const currentSubscribedTrack = subscribedTracksByLanguage.get(targetLanguage);
            
            if (currentSubscribedTrack && currentSubscribedTrack !== trackName) {
              // Unsubscribe from the old track first
              // Switching translation track
              unsubscribeFromOtherTracksForLanguage(targetLanguage, trackName);
            }
            
            // Subscribe to this track
            // Subscribing to language track
            if (!publication.isSubscribed) {
              publication.setSubscribed(true);
            }
            subscribedTracksByLanguage.set(targetLanguage, trackName);
          } else {
            // Not subscribing to foreign language track
          }
        }
      }
    };

    // Check for existing tracks when component mounts (in case tracks were published before we set up listeners)
    const checkExistingTracks = () => {
      // Checking existing tracks
      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((publication) => {
          const trackName = publication.trackName || '';
            if (trackName.startsWith('translation-')) {
              console.log('🔊 Found existing translation track:', trackName, 'subscribed:', publication.isSubscribed);
              
              // Update subscription based on mode and language selection
              if (!translationEnabled) {
                if (publication.isSubscribed) {
                  publication.setSubscribed(false);
                  // Unsubscribed from translation track (disabled)
                }
              } else if (roomMode === 'unified' && trackName.startsWith('translation-unified')) {
                // UNIFIED MODE: Subscribe to unified tracks
                if (!publication.isSubscribed) {
                  publication.setSubscribed(true);
                  // UNIFIED MODE: Subscribed to unified track
                }
              } else if (roomMode === 'normal') {
                // NORMAL MODE: Subscribe based on selected language
                // Skip unified tracks in normal mode
                if (trackName.startsWith('translation-unified')) {
                  if (publication.isSubscribed) {
                    publication.setSubscribed(false);
                    // Normal mode: Unsubscribed from unified track
                  }
                } else {
                  const targetLanguage = extractLanguageFromTrackName(trackName);
                  if (targetLanguage) {
                    if (targetLanguage === selectedLanguage) {
                      // Only subscribe to ONE track per target language
                      const currentSubscribedTrack = subscribedTracksByLanguage.get(targetLanguage);
                      
                      if (!currentSubscribedTrack) {
                        // No track subscribed yet for this language → subscribe to this one
                        if (!publication.isSubscribed) {
                          publication.setSubscribed(true);
                          // Subscribed to existing translation track
                          subscribedTracksByLanguage.set(targetLanguage, trackName);
                        }
                      } else if (currentSubscribedTrack === trackName) {
                        // This is the track we're already subscribed to → keep it
                        if (!publication.isSubscribed) {
                          publication.setSubscribed(true);
                          // Re-subscribed to existing translation track
                        }
                      } else {
                        // Another track is already subscribed → unsubscribe from this one
                        if (publication.isSubscribed) {
                          publication.setSubscribed(false);
                          // Unsubscribed from duplicate track
                        }
                      }
                    } else {
                      if (publication.isSubscribed) {
                        publication.setSubscribed(false);
                        // Unsubscribed from foreign language track
                      }
                    }
                  }
                }
              }
            }
        });
      });
    };

    // Handle track unsubscription to clean up our tracking
    const onTrackUnsubscribed = (track, publication, participant) => {
      if (track.kind !== 'audio') return;
      const trackName = publication.trackName || '';
      
      if (trackName.startsWith('translation-') && !trackName.startsWith('translation-unified')) {
        const targetLanguage = extractLanguageFromTrackName(trackName);
        if (targetLanguage) {
          const currentSubscribedTrack = subscribedTracksByLanguage.get(targetLanguage);
          
          // If this was the track we were tracking, remove it from the map
          if (currentSubscribedTrack === trackName) {
            // Track unsubscribed, removing from tracking
            subscribedTracksByLanguage.delete(targetLanguage);
          }
        }
      }
    };

    // Set up event listeners
    room.on('trackSubscribed', onTrackSubscribed);
    room.on('trackPublished', onTrackPublished);
    room.on('trackUnsubscribed', onTrackUnsubscribed);
    
    // Check existing tracks after a short delay (to ensure room is fully connected)
    setTimeout(checkExistingTracks, 1000);

    return () => {
      room.off('trackSubscribed', onTrackSubscribed);
      room.off('trackPublished', onTrackPublished);
      room.off('trackUnsubscribed', onTrackUnsubscribed);
      subscribedTracksByLanguage.clear();
    };
  }, [room, myIdentity, selectedLanguage, translationEnabled, roomMode]); // Add roomMode to dependencies

  return null; // This component doesn't render anything
}

// VAD Sensitivity Controls Component - Rendered in bottom control bar for host
export function VADSensitivityControls() {
  const [vadSensitivity, setVadSensitivity] = useState('normal');
  const [selectedVoice, setSelectedVoice] = useState('alloy');
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState('sensitivity'); // 'sensitivity' or 'voice'

  // Voice options
  const VOICE_OPTIONS = [
    { value: 'alloy', name: 'Alloy', description: 'Neutral, balanced' },
    { value: 'echo', name: 'Echo', description: 'Warm, engaging' },
    { value: 'shimmer', name: 'Shimmer', description: 'Energetic, expressive' },
    { value: 'marin', name: 'Marin', description: 'Professional, clear' },
    { value: 'cedar', name: 'Cedar', description: 'Natural, conversational' },
    { value: 'nova', name: 'Nova', description: 'Natural, conversational (female)' },
    { value: 'fable', name: 'Fable', description: 'Warm, expressive (male)' },
    { value: 'onyx', name: 'Onyx', description: 'Strong, authoritative (male)' },
  ];

  const handleVadChange = (level) => {
    if (window.__roomControls?.sendVadSetting) {
      window.__roomControls.sendVadSetting(level);
      setVadSensitivity(level);
    }
  };

  const handleVoiceChange = (voice) => {
    console.log('handleVoiceChange called with:', voice);
    console.log('window.__roomControls:', window.__roomControls);
    if (window.__roomControls?.sendVoiceSetting) {
      console.log('Calling sendVoiceSetting');
      window.__roomControls.sendVoiceSetting(voice);
      setSelectedVoice(voice);
    } else {
      console.error('sendVoiceSetting not available on window.__roomControls');
    }
  };


  // Sync with RoomControls state
  useEffect(() => {
    const interval = setInterval(() => {
      if (window.__roomControls?.vadSensitivity) {
        setVadSensitivity(window.__roomControls.vadSensitivity);
      }
      if (window.__roomControls?.selectedVoice) {
        setSelectedVoice(window.__roomControls.selectedVoice);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showDropdown) return;
    
    const handleClickOutside = (event) => {
      const target = event.target;
      console.log('Click outside handler triggered, target:', target);
      
      // Find the dropdown container (the .relative div)
      const dropdownContainer = target.closest('.relative');
      console.log('Dropdown container found:', !!dropdownContainer);
      
      if (dropdownContainer) {
        // Check if click is inside the dropdown menu div
        const dropdownMenu = dropdownContainer.querySelector('div.absolute.bottom-full');
        console.log('Dropdown menu found:', !!dropdownMenu, 'contains target:', dropdownMenu?.contains(target));
        
        if (dropdownMenu && dropdownMenu.contains(target)) {
          // Clicked inside dropdown menu, don't close
          console.log('Click inside dropdown, keeping open');
          return;
        }
      }
      
      // Clicked outside, close dropdown
      console.log('Click outside dropdown, closing');
      setShowDropdown(false);
    };
    
    // Use a small delay to avoid immediate closing when opening
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-all"
        title="Translation Settings"
        aria-label="Translation Settings"
      >
        <Settings className="w-5 h-5" />
        <span className="text-sm font-medium hidden sm:inline">Settings</span>
      </button>

      {showDropdown && (
        <div 
          className="absolute bottom-full right-0 mb-2 w-80 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-[9999] backdrop-blur-sm max-w-[calc(100vw-2rem)]"
          onClick={(e) => {
            e.stopPropagation();
            console.log('Dropdown menu clicked');
          }}
        >
          <div className="p-3">
            {/* Tab buttons */}
            <div className="flex gap-2 mb-3 border-b border-gray-700">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Switching to sensitivity tab');
                  setActiveTab('sensitivity');
                }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'sensitivity'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Sensitivity
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Switching to voice tab');
                  setActiveTab('voice');
                }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'voice'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Voice
              </button>
            </div>

            {/* Sensitivity Tab */}
            {activeTab === 'sensitivity' && (
              <div>
                <div className="text-xs text-gray-400 mb-3 font-medium">Translation Sensitivity</div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => {
                      handleVadChange('quiet_room');
                      setShowDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-md transition-all ${
                      vadSensitivity === 'quiet_room' 
                        ? 'bg-blue-900/50 border-2 border-blue-500' 
                        : 'bg-gray-700/50 border border-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    <div className="font-semibold text-sm text-white mb-1">Quiet Room</div>
                    <div className="text-xs text-gray-400 leading-relaxed">
                      Very sensitive - catches whispers, soft voices, headsets
                    </div>
                  </button>
                  
                  <button
                    onClick={() => {
                      handleVadChange('normal');
                      setShowDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-md transition-all ${
                      vadSensitivity === 'normal' 
                        ? 'bg-blue-900/50 border-2 border-blue-500' 
                        : 'bg-gray-700/50 border border-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    <div className="font-semibold text-sm text-white mb-1">Normal</div>
                    <div className="text-xs text-gray-400 leading-relaxed">
                      Balanced - good for most conversations (default)
                    </div>
                  </button>
                  
                  <button
                    onClick={() => {
                      handleVadChange('slow_speaker');
                      setShowDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-md transition-all ${
                      vadSensitivity === 'slow_speaker' 
                        ? 'bg-blue-900/50 border-2 border-blue-500' 
                        : 'bg-gray-700/50 border border-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    <div className="font-semibold text-sm text-white mb-1">Slow Speaker</div>
                    <div className="text-xs text-gray-400 leading-relaxed">
                      Longer pauses - waits for slow speakers' natural pauses (normal sensitivity)
                    </div>
                  </button>
                  
                  <button
                    onClick={() => {
                      handleVadChange('noisy_office');
                      setShowDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-md transition-all ${
                      vadSensitivity === 'noisy_office' 
                        ? 'bg-blue-900/50 border-2 border-blue-500' 
                        : 'bg-gray-700/50 border border-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    <div className="font-semibold text-sm text-white mb-1">Noisy Office</div>
                    <div className="text-xs text-gray-400 leading-relaxed">
                      Less sensitive - ignores coughs, "umm", background noise
                    </div>
                  </button>
                  
                  <button
                    onClick={() => {
                      handleVadChange('cafe_or_crowd');
                      setShowDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-md transition-all ${
                      vadSensitivity === 'cafe_or_crowd' 
                        ? 'bg-blue-900/50 border-2 border-blue-500' 
                        : 'bg-gray-700/50 border border-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    <div className="font-semibold text-sm text-white mb-1">Café or Crowd</div>
                    <div className="text-xs text-gray-400 leading-relaxed">
                      Very insensitive - only loud, clear speech triggers
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Voice Tab */}
            {activeTab === 'voice' && (
              <div>
                <div className="text-xs text-gray-400 mb-3 font-medium">Translation Voice</div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {VOICE_OPTIONS.map((voice) => (
                    <button
                      key={voice.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log('Voice selected:', voice.value);
                        handleVoiceChange(voice.value);
                        setShowDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-md transition-all ${
                        selectedVoice === voice.value
                          ? 'bg-blue-900/50 border-2 border-blue-500'
                          : 'bg-gray-700/50 border border-gray-600 hover:bg-gray-700'
                      }`}
                    >
                      <div className="font-semibold text-sm text-white mb-1">{voice.name}</div>
                      <div className="text-xs text-gray-400 leading-relaxed">{voice.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

export default MeetingRoom;
