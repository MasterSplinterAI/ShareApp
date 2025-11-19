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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center px-4">
      <div className="max-w-4xl w-full">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-4">
            LiveKit International Conference
          </h1>
          <p className="text-xl text-gray-300 mb-8">
            Connect globally with real-time video and live translation
          </p>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <div className="bg-gray-800 p-6 rounded-lg">
            <Video className="w-12 h-12 text-blue-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">HD Video & Audio</h3>
            <p className="text-gray-400">Crystal clear video conferencing powered by LiveKit Cloud</p>
          </div>
          <div className="bg-gray-800 p-6 rounded-lg">
            <Globe className="w-12 h-12 text-green-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Live Translation</h3>
            <p className="text-gray-400">Real-time audio translation in multiple languages</p>
          </div>
          <div className="bg-gray-800 p-6 rounded-lg">
            <Users className="w-12 h-12 text-purple-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No Login Required</h3>
            <p className="text-gray-400">Join instantly with just a link - no account needed</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={handleHostMeeting}
            disabled={isCreating}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-semibold py-4 px-8 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating Room...
              </>
            ) : (
              <>
                <Video className="w-5 h-5" />
                Host a Meeting
              </>
            )}
          </button>
          <button
            onClick={() => navigate('/join/room')}
            className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-4 px-8 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Users className="w-5 h-5" />
            Join with Link
          </button>
        </div>

        {/* Footer */}
        <div className="text-center mt-12 text-gray-400">
          <p>Powered by LiveKit Cloud • End-to-end encrypted • GDPR compliant</p>
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
