import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Users, Globe, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { roomService } from '../services/api';
import NameModal from './NameModal';

function HomeScreen() {
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [roomData, setRoomData] = useState(null);

  const handleHostMeeting = async () => {
    setIsCreating(true);
    try {
      // No roomMode needed - agent uses unified optimized mode automatically
      const response = await roomService.create();
      console.log('Room created:', response);
      setRoomData(response);
      setShowNameModal(true);
    } catch (error) {
      console.error('Failed to create room:', error);
      toast.error(error.response?.data?.error || 'Failed to create meeting room');
    } finally {
      setIsCreating(false);
    }
  };

  const handleNameSubmit = (name) => {
    if (roomData) {
      // Store info in sessionStorage as backup
      const participantInfo = {
        isHost: true, 
        participantName: name,
        hostCode: roomData.hostCode,
        shareableLink: roomData.shareableLink,
        shareableLinkNetwork: roomData.shareableLinkNetwork,
        roomName: roomData.roomName,
      };
      
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      
      // Navigate to the room as host
      navigate(`/room/${roomData.roomName}`, { 
        state: participantInfo
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        {/* Minimal Hero Section */}
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-semibold text-white mb-3">
            Video Conference
          </h1>
          <p className="text-gray-400 text-sm">
            Connect with real-time translation
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleHostMeeting}
            disabled={isCreating}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white font-medium py-3 px-6 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Creating...</span>
              </>
            ) : (
              <>
                <Video className="w-5 h-5" />
                <span>Start Meeting</span>
              </>
            )}
          </button>
          <button
            onClick={() => navigate('/join/room')}
            className="w-full bg-gray-800 hover:bg-gray-700 text-white font-medium py-3 px-6 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 border border-gray-700"
          >
            <Users className="w-5 h-5" />
            <span>Join Meeting</span>
          </button>
        </div>
      </div>

      {/* Name Modal */}
      {showNameModal && (
        <NameModal
          onClose={() => setShowNameModal(false)}
          onSubmit={handleNameSubmit}
          title="Enter Your Name"
          subtitle="This is how other participants will see you"
        />
      )}
    </div>
  );
}

export default HomeScreen;
