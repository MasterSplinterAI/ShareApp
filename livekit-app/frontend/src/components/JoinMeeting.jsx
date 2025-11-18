import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { roomService } from '../services/api';
import NameModal from './NameModal';

function JoinMeeting() {
  const { roomName } = useParams();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [roomInfo, setRoomInfo] = useState(null);
  const [error, setError] = useState(null);
  const [showNameModal, setShowNameModal] = useState(false);

  useEffect(() => {
    console.log('JoinMeeting: Component mounted with roomName:', roomName);
    checkRoom();
  }, [roomName]);

  const checkRoom = async () => {
    if (!roomName || roomName === 'room') {
      // User clicked "Join with Link" without a specific room
      setError('Please use a valid meeting link');
      setIsLoading(false);
      return;
    }

    try {
      const info = await roomService.getInfo(roomName);
      setRoomInfo(info);
      setShowNameModal(true);
    } catch (error) {
      console.error('Failed to check room:', error);
      if (error.response?.status === 404) {
        setError('Meeting room not found. The room may have ended or the link is invalid.');
      } else {
        setError('Failed to connect to the meeting. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleNameSubmit = (name) => {
    console.log('JoinMeeting: handleNameSubmit called with name:', name, 'roomName:', roomName);
    
    // Store participant info in sessionStorage to persist across navigation
    // Include roomMode from roomInfo if available
    const participantInfo = {
      participantName: name,
      isHost: false,
      roomName: roomName,
      roomMode: roomInfo?.roomMode || 'multi-language' // Get room mode from room info
    };
    
    sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
    console.log('JoinMeeting: Saved to sessionStorage:', participantInfo);
    console.log('JoinMeeting: Verifying sessionStorage:', sessionStorage.getItem('participantInfo'));
    
    // Use replace: false to ensure proper navigation
    // Use a small delay to ensure sessionStorage is written
    setTimeout(() => {
      console.log('JoinMeeting: Navigating to:', `/room/${roomName}`);
      console.log('JoinMeeting: SessionStorage before nav:', sessionStorage.getItem('participantInfo'));
      navigate(`/room/${roomName}`, { 
        state: participantInfo,
        replace: false
      });
    }, 10);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-300">Checking meeting room...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-gray-800 rounded-lg p-8 text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-white mb-2">Unable to Join</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-gray-800 rounded-lg p-8">
        <div className="text-center mb-6">
          <Users className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-white mb-2">Join Meeting</h2>
          {roomInfo && roomInfo.numParticipants > 0 && (
            <p className="text-gray-400">
              {roomInfo.numParticipants} participant{roomInfo.numParticipants !== 1 ? 's' : ''} in room
            </p>
          )}
        </div>
      </div>

      {showNameModal && (
        <NameModal
          onClose={() => {
            setShowNameModal(false);
            navigate('/');
          }}
          onSubmit={handleNameSubmit}
          title="Join Meeting"
          subtitle="Enter your name to join the conference"
        />
      )}
    </div>
  );
}

export default JoinMeeting;
