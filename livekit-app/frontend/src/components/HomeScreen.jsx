import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Users, Globe, Loader2, Link2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { roomService } from '../services/api';
import NameModal from './NameModal';

function HomeScreen() {
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
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

  const handleCreateInvite = async () => {
    setIsCreatingInvite(true);
    try {
      const response = await roomService.createInvite();
      await navigator.clipboard.writeText(response.inviteLink);
      setInviteCopied(true);
      toast.success('Invite link copied to clipboard!');
      setTimeout(() => setInviteCopied(false), 3000);
    } catch (error) {
      console.error('Failed to create invite:', error);
      toast.error('Failed to create invite link');
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const handleNameSubmit = (name, selectedLanguage = 'en', spokenLanguage = null) => {
    if (roomData) {
      const spoken = spokenLanguage ?? selectedLanguage;
      // Store info in sessionStorage as backup
      const participantInfo = {
        isHost: true, 
        participantName: name,
        hostCode: roomData.hostCode,
        shareableLink: roomData.shareableLink,
        shareableLinkNetwork: roomData.shareableLinkNetwork,
        roomName: roomData.roomName,
        selectedLanguage: selectedLanguage,
        spokenLanguage: spoken
      };
      
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      
      // Preserve ?debug=1 when navigating to room
      const search = window.location.search;
      navigate(`/room/${roomData.roomName}${search}`, { 
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
          <button
            onClick={handleCreateInvite}
            disabled={isCreatingInvite}
            className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-medium py-3 px-6 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 border border-gray-700"
          >
            {isCreatingInvite ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Creating...</span>
              </>
            ) : inviteCopied ? (
              <>
                <Check className="w-5 h-5 text-green-400" />
                <span className="text-green-400">Link Copied!</span>
              </>
            ) : (
              <>
                <Link2 className="w-5 h-5" />
                <span>Create Invite Link</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Name Modal */}
      {showNameModal && (
        <NameModal
          onClose={() => setShowNameModal(false)}
          onSubmit={handleNameSubmit}
          title="Enter Your Name"
          subtitle="This is how other participants will see you. Select your preferred translation language."
          showLanguageSelector={true}
          defaultLanguage="en"
        />
      )}
    </div>
  );
}

export default HomeScreen;
