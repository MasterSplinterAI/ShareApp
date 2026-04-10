import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { LiveKitRoom, useRoomContext, RoomAudioRenderer, StartAudio } from '@livekit/components-react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { authService } from '../services/api';
import ShareModal from './ShareModal';
import TranscriptionPanel from './TranscriptionPanel';
import RoomControls from './RoomControls';
import TranslationDebugPanel from './TranslationDebugPanel';
import CustomControlBar from './CustomControlBar';
import VideoGrid from './VideoGrid';
import { MeetingProvider, useMeeting } from '../context/MeetingContext';
import { normalizeMeetingLanguageCode } from '../lib/languages';
// Autopilot Translator SDK — for DOM/UI translation (navigation, buttons, labels)
import { AutopilotTranslator } from '../lib/autopilot-translator';

function MeetingRoom() {
  const { roomName } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [token, setToken] = useState(null);
  const [livekitUrl, setLivekitUrl] = useState(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState(null);
  const [participantInfo, setParticipantInfo] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize participant info on mount
  useEffect(() => {
    const stateInfo = location.state || {};
    let sessionInfo = {};

    try {
      const sessionData = sessionStorage.getItem('participantInfo');
      if (sessionData) {
        sessionInfo = JSON.parse(sessionData);
      }
    } catch (e) {
      console.error('Error parsing sessionStorage:', e);
    }

    // Check if sessionStorage roomName matches current roomName
    if (sessionInfo.roomName && sessionInfo.roomName !== roomName) {
      sessionStorage.removeItem('participantInfo');
      sessionInfo = {};
    }

    const participantName = stateInfo.participantName || sessionInfo.participantName;
    const isHost = stateInfo.isHost !== undefined ? stateInfo.isHost : (sessionInfo.isHost ?? false);
    const hostCode = stateInfo.hostCode || sessionInfo.hostCode;
    const shareableLink = stateInfo.shareableLink || sessionInfo.shareableLink;
    const shareableLinkNetwork = stateInfo.shareableLinkNetwork || sessionInfo.shareableLinkNetwork;
    const selectedLanguage = normalizeMeetingLanguageCode(
      stateInfo.selectedLanguage || sessionInfo.selectedLanguage || 'en'
    );
    const spokenLanguage = normalizeMeetingLanguageCode(
      stateInfo.spokenLanguage || sessionInfo.spokenLanguage || selectedLanguage
    );

    if (!participantName) {
      navigate(`/join/${roomName}`, { replace: true });
      return;
    }

    setParticipantInfo({
      participantName,
      isHost,
      hostCode,
      shareableLink,
      shareableLinkNetwork,
      selectedLanguage,
      spokenLanguage,
    });

    setIsInitialized(true);
  }, [roomName, navigate]);

  // Connect to room once initialized
  useEffect(() => {
    if (!isInitialized || !participantInfo) return;
    connectToRoom();
  }, [isInitialized, participantInfo]);

  const connectToRoom = async () => {
    if (!participantInfo) return;

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

  // Handle orientation changes
  useEffect(() => {
    let resizeTimer;
    const handleOrientationChange = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
    };

    window.addEventListener('orientationchange', handleOrientationChange);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('orientationchange', handleOrientationChange);
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
    <MeetingProvider
      initialState={{
        roomName,
        isHost: participantInfo.isHost,
        participantName: participantInfo.participantName,
        selectedLanguage: participantInfo.selectedLanguage,
        spokenLanguage: participantInfo.spokenLanguage,
        translationEnabled: true,
        meetingMode: 'translation',
      }}
    >
      <MeetingRoomInner
        token={token}
        livekitUrl={livekitUrl}
        participantInfo={participantInfo}
        roomName={roomName}
        onDisconnected={handleDisconnected}
      />
    </MeetingProvider>
  );
}

function MeetingRoomInner({ token, livekitUrl, participantInfo, roomName, onDisconnected }) {
  const {
    selectedLanguage,
    setSelectedLanguage,
    translationEnabled,
    setTranslationEnabled,
    isPanelOpen,
  } = useMeeting();

  const [showShareModal, setShowShareModal] = useState(false);
  const translatorRef = useRef(null);
  const selectedLanguageRef = useRef(selectedLanguage);

  // Keep ref in sync
  useEffect(() => {
    selectedLanguageRef.current = selectedLanguage;
  }, [selectedLanguage]);

  // Autopilot Translator — DOM/UI translation (navigation, buttons, labels)
  useEffect(() => {
    if (!selectedLanguage || selectedLanguage === 'en') {
      if (translatorRef.current) {
        translatorRef.current.setLanguage('en').catch(() => {});
        translatorRef.current.destroy();
        translatorRef.current = null;
        localStorage.removeItem('app_language');
      }
      return;
    }

    // Get API endpoint
    const isNetworkAccess = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const isNgrok = window.location.hostname.includes('ngrok');
    const isHTTPS = window.location.protocol === 'https:';
    let API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
    if (isNgrok || (isNetworkAccess && isHTTPS)) {
      API_BASE_URL = '/api';
    } else if (isNetworkAccess) {
      API_BASE_URL = `http://${window.location.hostname}:3001/api`;
    }

    if (translatorRef.current) {
      translatorRef.current.setLanguage(selectedLanguage).catch(err => {
        console.error('Error changing DOM language:', err);
      });
    } else {
      const translator = new AutopilotTranslator({
        apiEndpoint: API_BASE_URL,
        language: selectedLanguage,
        enabledPages: [],
      });
      translatorRef.current = translator;
      translator.init(selectedLanguage, []);
    }

    return () => {
      // Only destroy on unmount, not on language change
    };
  }, [selectedLanguage]);

  // Cleanup translator on unmount
  useEffect(() => {
    return () => {
      if (translatorRef.current) {
        translatorRef.current.destroy();
        translatorRef.current = null;
      }
    };
  }, []);

  return (
    <div className="h-[100dvh] bg-gray-900 relative overflow-hidden w-full">
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={livekitUrl || import.meta.env.VITE_LIVEKIT_URL || 'wss://production-uiycx4ku.livekit.cloud'}
        onDisconnected={onDisconnected}
        options={{
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: {
            videoSimulcastLayers: [],
            videoCodec: 'vp8',
          },
        }}
        className="h-full flex flex-col"
      >
        {/* Main content area: video grid + optional transcription panel */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Video grid takes remaining space */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <VideoGrid />
          </div>

          {/* Transcription panel — side panel on desktop, bottom sheet on mobile */}
          <TranscriptionPanel />
        </div>

        {/* Room controls for broadcasting language preferences */}
        <RoomControls
          selectedLanguage={selectedLanguage}
          translationEnabled={translationEnabled}
          participantName={participantInfo?.participantName || ''}
          isHost={participantInfo?.isHost || false}
        />

        {/* Control bar */}
        <CustomControlBar
          selectedLanguage={selectedLanguage}
          setSelectedLanguage={setSelectedLanguage}
          translationEnabled={translationEnabled}
          setTranslationEnabled={setTranslationEnabled}
          isHost={participantInfo?.isHost || false}
          onShareClick={() => setShowShareModal(true)}
          onDisconnect={onDisconnected}
        />

        {/* Debug panel — add ?debug=1 to URL */}
        <TranslationDebugPanel
          selectedLanguage={selectedLanguage}
          spokenLanguage={selectedLanguage}
          translationEnabled={translationEnabled}
          participantName={participantInfo?.participantName || ''}
        />

        <RoomAudioRenderer />
        <StartAudio label="Click to enable audio" />
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

export default MeetingRoom;
