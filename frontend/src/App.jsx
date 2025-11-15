import { useState, useEffect } from 'react';
import HomeScreen from './components/HomeScreen';
import MeetingRoom from './components/MeetingRoom';
import NameModal from './components/NameModal';
import ToastContainer from './components/ToastContainer';
import { useToast } from './hooks/useToast';
import { getMeetingIdFromUrl, parseMeetingUrl } from './utils/urlParser';

function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' or 'meeting'
  const [meetingId, setMeetingId] = useState(null);
  const [roomUrl, setRoomUrl] = useState(null);
  const [participantName, setParticipantName] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingMeetingId, setPendingMeetingId] = useState(null);
  const [shareableLink, setShareableLink] = useState(null);
  const [shareableLinkNetwork, setShareableLinkNetwork] = useState(null);
  const [hostCode, setHostCode] = useState(null);
  const { toasts, removeToast, success, error } = useToast();

  // Check URL on mount for auto-join
  useEffect(() => {
    const urlMeetingId = getMeetingIdFromUrl();
    if (urlMeetingId) {
      const parsed = parseMeetingUrl(window.location.href);
      setPendingMeetingId(urlMeetingId);
      setIsHost(parsed?.isHost || false);
      
      // If name is in URL, use it; otherwise show name modal
      if (parsed?.name) {
        setMeetingId(urlMeetingId);
        setParticipantName(parsed.name);
        setIsHost(parsed.isHost || false);
        setCurrentView('meeting');
        setShowNameModal(false);
        success(`Joined meeting as ${parsed.name}`);
      } else {
        setShowNameModal(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJoinMeeting = (id, name, host = false, url = null) => {
    try {
      setMeetingId(id);
      setRoomUrl(url);
      setParticipantName(name);
      setIsHost(host);
      setCurrentView('meeting');
      setShowNameModal(false);
      success(`Joined meeting as ${name}`);
    } catch (err) {
      error('Failed to join meeting');
    }
  };

  const handleCreateMeeting = (id, name, host = true, url = null, shareLink = null, shareLinkNetwork = null, code = null) => {
    try {
      setMeetingId(id);
      setRoomUrl(url);
      setParticipantName(name);
      setIsHost(host);
      setShareableLink(shareLink);
      setShareableLinkNetwork(shareLinkNetwork);
      setHostCode(code);
      setCurrentView('meeting');
      success(`Meeting created! Welcome, ${name}`);
    } catch (err) {
      error('Failed to create meeting');
    }
  };

  const handleLeaveMeeting = () => {
    setCurrentView('home');
    setMeetingId(null);
    setRoomUrl(null);
    setParticipantName(null);
    setIsHost(false);
    setShareableLink(null);
    setShareableLinkNetwork(null);
    setHostCode(null);
    // Reset URL
    window.history.pushState({}, '', '/');
    success('Left meeting');
  };

  const handleNameSubmit = (name) => {
    if (pendingMeetingId) {
      handleJoinMeeting(pendingMeetingId, name, isHost);
      setPendingMeetingId(null);
    }
  };

  return (
    <div className="App">
      {currentView === 'home' ? (
        <HomeScreen
          onJoinMeeting={handleJoinMeeting}
          onCreateMeeting={handleCreateMeeting}
        />
      ) : (
        <MeetingRoom
          meetingId={meetingId}
          roomUrl={roomUrl}
          name={participantName}
          isHost={isHost}
          onLeave={handleLeaveMeeting}
          shareableLink={shareableLink}
          shareableLinkNetwork={shareableLinkNetwork}
          hostCode={hostCode}
        />
      )}

      {/* Name Modal for URL-based joins */}
      <NameModal
        isOpen={showNameModal}
        onClose={() => {
          setShowNameModal(false);
          setPendingMeetingId(null);
        }}
        onSubmit={handleNameSubmit}
        defaultName="Guest"
        title="Enter your name to join"
      />

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

export default App;
