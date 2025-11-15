import { useState } from 'react';
import NameModal from './NameModal';
import JoinMeeting from './JoinMeeting';
import ShareModal from './ShareModal';
import { meetingService, tokenService } from '../services/api';
import { updateUrl } from '../utils/urlParser';

const HomeScreen = ({ onJoinMeeting, onCreateMeeting }) => {
  const [showNameModal, setShowNameModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'host' or 'join'
  const [meetingData, setMeetingData] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleHostClick = () => {
    setPendingAction('host');
    setShowNameModal(true);
  };

  const handleJoinClick = () => {
    setPendingAction('join');
    setShowJoinModal(true);
  };

  const handleNameSubmit = async (name) => {
    setShowNameModal(false);
    
    if (pendingAction === 'host') {
      await handleCreateMeeting(name);
    }
  };

  const handleCreateMeeting = async (hostName) => {
    setLoading(true);
    try {
      const data = await meetingService.createMeeting();
      setMeetingData({ ...data, hostName });
      setShowShareModal(true);
      
      // Update URL
      updateUrl(data.meetingId, { isHost: true, code: data.hostCode });
      
      // Call parent callback if provided
      if (onCreateMeeting) {
        onCreateMeeting(
          data.meetingId, 
          hostName, 
          true, 
          data.roomUrl,
          data.shareableLink,
          data.shareableLinkNetwork,
          data.hostCode
        );
      }
    } catch (error) {
      console.error('Failed to create meeting:', error);
      alert('Failed to create meeting. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinMeeting = async (meetingId, participantName) => {
    setShowJoinModal(false);
    setLoading(true);
    
    try {
      // Validate meeting
      const validation = await meetingService.validateMeeting(meetingId);
      
      if (!validation.valid || !validation.exists) {
        alert('Meeting not found. Please check the meeting ID.');
        return;
      }

      // Update URL
      updateUrl(meetingId, { name: participantName });
      
      // Call parent callback
      if (onJoinMeeting) {
        onJoinMeeting(meetingId, participantName, false, validation.roomUrl);
      }
    } catch (error) {
      console.error('Failed to join meeting:', error);
      alert('Failed to join meeting. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartMeeting = () => {
    setShowShareModal(false);
    if (meetingData && onCreateMeeting) {
      onCreateMeeting(
        meetingData.meetingId, 
        meetingData.hostName, 
        true, 
        meetingData.roomUrl,
        meetingData.shareableLink,
        meetingData.shareableLinkNetwork,
        meetingData.hostCode
      );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full text-center">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-800 mb-4">
            Video Conference
          </h1>
          <p className="text-xl text-gray-600">
            Connect with anyone, anywhere
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
          <button
            onClick={handleHostClick}
            disabled={loading}
            className="w-full sm:w-64 px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-lg font-semibold rounded-lg shadow-lg hover:from-blue-700 hover:to-blue-800 transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Host Meeting
            </span>
          </button>

          <button
            onClick={handleJoinClick}
            disabled={loading}
            className="w-full sm:w-64 px-8 py-4 bg-gradient-to-r from-purple-600 to-purple-700 text-white text-lg font-semibold rounded-lg shadow-lg hover:from-purple-700 hover:to-purple-800 transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Join Meeting
            </span>
          </button>
        </div>

        {loading && (
          <div className="text-gray-600">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2">Please wait...</p>
          </div>
        )}

        {/* Features */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="text-3xl mb-3">🎥</div>
            <h3 className="font-semibold text-gray-800 mb-2">HD Video</h3>
            <p className="text-gray-600 text-sm">Crystal clear video quality</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="text-3xl mb-3">🌐</div>
            <h3 className="font-semibold text-gray-800 mb-2">Translation</h3>
            <p className="text-gray-600 text-sm">Real-time language translation</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="text-3xl mb-3">📱</div>
            <h3 className="font-semibold text-gray-800 mb-2">Mobile Ready</h3>
            <p className="text-gray-600 text-sm">Works on all devices</p>
          </div>
        </div>
      </div>

      {/* Modals */}
      <NameModal
        isOpen={showNameModal}
        onClose={() => {
          setShowNameModal(false);
          setPendingAction(null);
        }}
        onSubmit={handleNameSubmit}
        defaultName={pendingAction === 'host' ? 'Host' : 'Guest'}
        title={pendingAction === 'host' ? 'Enter your name to host' : 'Enter your name'}
      />

      <JoinMeeting
        isOpen={showJoinModal}
        onClose={() => {
          setShowJoinModal(false);
          setPendingAction(null);
        }}
        onJoin={(meetingId) => {
          setPendingAction('join');
          setShowNameModal(true);
          // Store meetingId temporarily
          setMeetingData({ meetingId });
        }}
      />

      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        meetingId={meetingData?.meetingId}
        shareableLink={meetingData?.shareableLink}
        shareableLinkNetwork={meetingData?.shareableLinkNetwork}
        hostCode={meetingData?.hostCode}
      />

      {showShareModal && meetingData && (
        <div className="fixed bottom-4 right-4 bg-white p-4 rounded-lg shadow-lg">
          <button
            onClick={handleStartMeeting}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Start Meeting
          </button>
        </div>
      )}
    </div>
  );
};

export default HomeScreen;

