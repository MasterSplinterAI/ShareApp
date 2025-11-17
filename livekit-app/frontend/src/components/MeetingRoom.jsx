import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { LiveKitRoom, VideoConference, formatChatMessageLinks } from '@livekit/components-react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { authService } from '../services/api';
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
        serverUrl={import.meta.env.VITE_LIVEKIT_URL || 'wss://jayme-rhmomj8r.livekit.cloud'}
        onDisconnected={handleDisconnected}
        data-lk-theme="default"
        className="h-full"
      >
        <VideoConference 
          chatMessageFormatter={formatChatMessageLinks}
        />
        
        {/* Room controls for handling translation data */}
        <RoomControls 
          selectedLanguage={selectedLanguage}
          translationEnabled={translationEnabled}
          participantName={participantInfo?.participantName || ''}
        />
        
        {/* Custom overlay for language selection and share button */}
        <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
          <LanguageSelector
            value={selectedLanguage}
            onChange={setSelectedLanguage}
            onTranslationToggle={() => setTranslationEnabled(!translationEnabled)}
            translationEnabled={translationEnabled}
          />
          {participantInfo?.isHost && (
            <button
              onClick={() => setShowShareModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
            >
              Share Meeting
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

export default MeetingRoom;
