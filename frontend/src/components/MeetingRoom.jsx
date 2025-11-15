import { useState, useEffect, useRef } from 'react';
import { DailyProvider, useDaily, useLocalParticipant, useDailyEvent } from '@daily-co/daily-react';
import { tokenService, meetingService } from '../services/api';
import VideoGrid from './VideoGrid';
import Controls from './Controls';
import ChatPanel from './ChatPanel';
import ParticipantsList from './ParticipantsList';
import TranslationControls from './TranslationControls';
import ShareModal from './ShareModal';
import LanguageSelector from './LanguageSelector';

const MeetingContent = ({ roomUrl, name, isHost, onLeave, meetingId, token, shareableLink, shareableLinkNetwork, hostCode }) => {
  const daily = useDaily();
  const localParticipant = useLocalParticipant();
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const desiredAudioState = useRef(true); // Track what audio state we want

  // Monitor participant updates to ensure audio stays enabled when video is disabled
  useDailyEvent('participant-updated', (event) => {
    if (event.participant.local && daily) {
      const participant = event.participant;
      // If video was just disabled but audio should be enabled, ensure audio stays on
      if (!participant.video && desiredAudioState.current && !participant.audio) {
        console.log('Audio was disabled when video turned off, re-enabling...');
        daily.setLocalAudio(true).catch(err => {
          console.error('Failed to re-enable audio:', err);
        });
      }
    }
  });

  useEffect(() => {
    if (!daily || !roomUrl || !token) return;

    const joinMeeting = async () => {
      try {
        console.log('Joining Daily.co room:', roomUrl);
        await daily.join({ 
          url: roomUrl, 
          userName: name, 
          token,
          // Explicitly enable audio and video
          startVideoOff: false,
          startAudioOff: false
        });
        console.log('Successfully joined Daily.co room');
        
        // Ensure audio and video are enabled after join
        await daily.setLocalAudio(true);
        await daily.setLocalVideo(true);
        desiredAudioState.current = true;
        console.log('Audio and video enabled');
      } catch (error) {
        console.error('Failed to join Daily.co room:', error);
        // Daily.co SDK will handle retries automatically
      }
    };

    joinMeeting();
    
    return () => {
      if (daily) {
        daily.leave();
      }
    };
  }, [daily, roomUrl, name, token]);

  const handleLeave = () => {
    if (daily) {
      daily.leave();
    }
    if (onLeave) {
      onLeave();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      {/* Main Content Area */}
      <div className="flex-1 relative">
        <VideoGrid />
        
        {/* Translation Controls - Host Only */}
        {isHost && (
          <div className="absolute top-4 left-4 z-10">
            <TranslationControls 
              meetingId={meetingId} 
              onTranslationEnabled={setTranslationEnabled}
            />
          </div>
        )}

        {/* Language Selector - All Participants (when translation is enabled) */}
        {translationEnabled && localParticipant?.session_id && (
          <div className="absolute top-4 left-4 z-10" style={isHost ? { top: '80px' } : {}}>
            <LanguageSelector
              meetingId={meetingId}
              participantId={localParticipant.session_id}
              currentLanguage={selectedLanguage}
              onLanguageChange={setSelectedLanguage}
            />
          </div>
        )}

        {/* Share Button - Host Only */}
        {isHost && (shareableLink || shareableLinkNetwork) && (
          <div className="absolute top-4 right-4 z-10">
            <button
              onClick={() => setShowShareModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </button>
          </div>
        )}

        {/* Chat Panel */}
        {showChat && (
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-white z-20">
            <ChatPanel onClose={() => setShowChat(false)} />
          </div>
        )}

        {/* Participants List */}
        {showParticipants && (
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-white z-20">
            <ParticipantsList onClose={() => setShowParticipants(false)} />
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <Controls
        onLeave={handleLeave}
        onToggleChat={() => setShowChat(!showChat)}
        onToggleParticipants={() => setShowParticipants(!showParticipants)}
        showChat={showChat}
        showParticipants={showParticipants}
      />

      {/* Share Modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        meetingId={meetingId}
        shareableLink={shareableLink}
        shareableLinkNetwork={shareableLinkNetwork}
        hostCode={hostCode}
      />
    </div>
  );
};

const MeetingRoom = ({ meetingId, name, isHost, onLeave, roomUrl, shareableLink, shareableLinkNetwork, hostCode }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dailyRoomUrl, setDailyRoomUrl] = useState(null);
  const [token, setToken] = useState(null);

  useEffect(() => {
    let isMounted = true;
    
    const setupRoom = async () => {
      try {
        // Always fetch room info from backend to ensure we have the correct Daily.co URL
        // This handles cases where roomUrl might be null, invalid, or contain placeholder domains
        let finalRoomUrl = roomUrl;
        
        // Validate roomUrl - if it's missing, invalid, or contains placeholder, fetch from backend
        const isValidUrl = finalRoomUrl && 
                          !finalRoomUrl.includes('yourdomain') && 
                          finalRoomUrl.includes('.daily.co') &&
                          finalRoomUrl.startsWith('https://');
        
        if (!isValidUrl) {
          if (!meetingId) {
            throw new Error('Meeting ID is required');
          }
          
          console.log('Fetching room info for meeting:', meetingId, 'Current roomUrl:', finalRoomUrl);
          // Fetch room info to get the actual Daily.co URL
          const roomInfo = await meetingService.getMeetingInfo(meetingId);
          finalRoomUrl = roomInfo.roomUrl;
          console.log('Fetched room URL:', finalRoomUrl);
        }

        // Final validation
        if (!finalRoomUrl || finalRoomUrl.includes('yourdomain') || !finalRoomUrl.includes('.daily.co')) {
          throw new Error(`Invalid room URL: ${finalRoomUrl}. Please check the meeting ID.`);
        }

        // Extract room name from URL (e.g., https://domain.daily.co/room-name -> room-name)
        const roomName = finalRoomUrl.split('/').pop() || meetingId;
        
        // Fetch token for joining the room
        const meetingToken = await tokenService.getToken(roomName, name, isHost);
        
        if (isMounted) {
          setDailyRoomUrl(finalRoomUrl);
          setToken(meetingToken);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to setup room:', err);
        if (isMounted) {
          const errorMessage = err.response?.data?.error || err.response?.data?.details || err.message || 'Failed to connect';
          setError(`Connection error: ${errorMessage}. Please check your Daily.co API key and try again.`);
          setLoading(false);
        }
      }
    };

    setupRoom();
    
    return () => {
      isMounted = false;
    };
  }, [meetingId, roomUrl, name, isHost]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
          <p className="text-white text-lg">Connecting to meeting...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-center bg-white p-8 rounded-lg shadow-xl max-w-md">
          <p className="text-red-600 text-lg mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!dailyRoomUrl || !token) {
    return null;
  }

  return (
    <DailyProvider>
      <MeetingContent
        roomUrl={dailyRoomUrl}
        name={name}
        isHost={isHost}
        onLeave={onLeave}
        meetingId={meetingId}
        token={token}
        shareableLink={shareableLink}
        shareableLinkNetwork={shareableLinkNetwork}
        hostCode={hostCode}
      />
    </DailyProvider>
  );
};

export default MeetingRoom;

